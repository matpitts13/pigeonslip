// Turns dropped or browsed files into labels. Each PDF page (or picture)
// becomes one label: the printed area is found and trimmed, and an upright
// 300 dpi picture is made for the preview and for printing.
import * as pdfjs from "../vendor/pdfjs/build/pdf.mjs";
import { findContentBox } from "../shared/bounds.js";
import { LABEL } from "../shared/layout.js";

const VENDOR = new URL("../vendor/pdfjs/", import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc = `${VENDOR}build/pdf.worker.mjs`;

const PRINT_DPI = 300;
const DETECT_DPI = 100; // plenty to find a label's edges, and quick
const MAX_PAGES = 200; // per file; a label download is a handful of pages
const MAX_FILE_BYTES = 200 * 1024 * 1024;

let nextId = 1;

/**
 * @typedef {object} Label
 * @property {string} id
 * @property {string} name file name
 * @property {number} pageNo 1-based
 * @property {number} pageCount pages in the file (1 for pictures)
 * @property {string} [sourceId] set for PDF labels (vector output)
 * @property {number} [pageIndex]
 * @property {{left:number,bottom:number,right:number,top:number}} [box] PDF points
 * @property {{png:Uint8Array,w:number,h:number}} raster upright picture
 * @property {string} url object URL of the picture, for <img>
 */

/**
 * What kind of file the bytes are, from their first bytes (not the extension).
 * @param {Uint8Array} b
 * @returns {"pdf"|"image"|null}
 */
export function sniff(b) {
  const head = String.fromCharCode(...b.subarray(0, 12));
  // Picture signatures first: a picture's metadata could contain "%PDF-".
  if (b[0] === 0x89 && head.slice(1, 4) === "PNG") return "image";
  if (b[0] === 0xff && b[1] === 0xd8) return "image";
  if (head.startsWith("GIF8") || head.startsWith("BM")) return "image";
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "image";
  // PDFs may have a little junk before the header; look in the first 1 KB.
  if (String.fromCharCode(...b.subarray(0, 1024)).includes("%PDF-")) return "pdf";
  return null;
}

/**
 * Reads one file into labels.
 * @param {{name:string, bytes:Uint8Array}} file
 * @param {{trim:boolean}} opts
 * @returns {Promise<{labels: Label[], source?: {id:string, bytes:Uint8Array}, skipped: number}>}
 */
export async function loadFile(file, opts) {
  if (file.bytes.length > MAX_FILE_BYTES) throw new Error(`${file.name} is over 200 MB.`);
  const kind = sniff(file.bytes);
  if (kind === "pdf") return loadPdf(file, opts);
  if (kind === "image") return loadImage(file, opts);
  throw new Error(`${file.name} isn't a PDF or a picture (PNG, JPG, GIF, WebP).`);
}

/** @param {{name:string, bytes:Uint8Array}} file @param {{trim:boolean}} opts */
async function loadPdf(file, opts) {
  const sourceId = `src${nextId++}`;
  // pdf.js takes ownership of the buffer it's given, so hand it a copy.
  const task = pdfjs.getDocument({
    data: file.bytes.slice(),
    standardFontDataUrl: `${VENDOR}standard_fonts/`,
    cMapUrl: `${VENDOR}cmaps/`,
    cMapPacked: true,
    wasmUrl: `${VENDOR}wasm/`,
    iccUrl: `${VENDOR}iccs/`,
    isEvalSupported: false,
    enableXfa: false,
  });
  const doc = await task.promise.catch(async (err) => {
    await task.destroy();
    const msg = err?.name === "PasswordException" ? "is password-protected" : "couldn't be opened";
    throw new Error(`${file.name} ${msg}.`);
  });
  const labels = [];
  try {
    const pageCount = doc.numPages;
    let skipped = 0;
    for (let i = 0; i < Math.min(pageCount, MAX_PAGES); i++) {
      const page = await doc.getPage(i + 1);
      const label = await pageToLabel(page, opts.trim);
      page.cleanup();
      if (!label) {
        skipped++;
        continue;
      }
      labels.push({ id: `l${nextId++}`, name: file.name, pageNo: i + 1, pageCount, sourceId, pageIndex: i, ...label });
    }
    skipped += Math.max(0, pageCount - MAX_PAGES);
    return { labels, source: { id: sourceId, bytes: file.bytes }, skipped };
  } catch (err) {
    for (const l of labels) URL.revokeObjectURL(l.url); // free the pages made before the failure
    throw new Error(`${file.name} couldn't be read: ${err instanceof Error ? err.message : err}`);
  } finally {
    await task.destroy();
  }
}

/**
 * Finds the printed area of one page and renders it upright at print size.
 * Works in the page's unrotated space so the box matches what pdf-lib embeds.
 * @returns {Promise<{box:{left:number,bottom:number,right:number,top:number}, raster:{png:Uint8Array,w:number,h:number}, url:string}|null>}
 */
async function pageToLabel(page, trim) {
  const detectVp = page.getViewport({ scale: DETECT_DPI / 72, rotation: 0 });
  let px = { x: 0, y: 0, w: Math.ceil(detectVp.width), h: Math.ceil(detectVp.height) };
  {
    const c = canvas(px.w, px.h);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    await page.render({ canvasContext: ctx, viewport: detectVp, background: "white" }).promise;
    const found = findContentBox(ctx.getImageData(0, 0, px.w, px.h).data, px.w, px.h, { pad: 3 });
    if (!found) return null; // blank page
    if (trim) px = found;
  }
  // Pixel box → PDF points (unrotated user space).
  const [x1, y1] = detectVp.convertToPdfPoint(px.x, px.y);
  const [x2, y2] = detectVp.convertToPdfPoint(px.x + px.w, px.y + px.h);
  const box = { left: Math.min(x1, x2), right: Math.max(x1, x2), bottom: Math.min(y1, y2), top: Math.max(y1, y2) };
  const wPt = box.right - box.left;
  const hPt = box.top - box.bottom;
  const ppp = printScale(wPt / 72, hPt / 72) / 72; // pixels per point
  const printVp = page.getViewport({ scale: ppp, rotation: 0 });
  const offX = (px.x / detectVp.scale) * ppp;
  const offY = (px.y / detectVp.scale) * ppp;
  const w = Math.max(1, Math.round(wPt * ppp));
  const h = Math.max(1, Math.round(hPt * ppp));
  const c = canvas(w, h);
  const ctx = c.getContext("2d");
  await page.render({ canvasContext: ctx, viewport: printVp, transform: [1, 0, 0, 1, -offX, -offY], background: "white" }).promise;
  return { box, ...(await finishRaster(c)) };
}

/**
 * Pixels per inch to render the artwork at so it comes out at 300 dpi once
 * shrunk (or grown) to fit a 4 × 6 in label.
 * @param {number} wIn artwork width in inches
 * @param {number} hIn artwork height in inches
 */
function printScale(wIn, hIn) {
  const [uw, uh] = wIn > hIn ? [hIn, wIn] : [wIn, hIn]; // upright size
  const fit = Math.min(LABEL.w / uw, LABEL.h / uh);
  return PRINT_DPI * fit;
}

/** @param {{name:string, bytes:Uint8Array}} file @param {{trim:boolean}} opts */
async function loadImage(file, opts) {
  let bmp;
  try {
    bmp = await createImageBitmap(new Blob([file.bytes]));
  } catch {
    throw new Error(`${file.name} couldn't be read as a picture.`);
  }
  try {
    let box = { x: 0, y: 0, w: bmp.width, h: bmp.height };
    if (opts.trim) {
      // Look for the edges on a smaller copy, then scale the box back up.
      const k = Math.min(1, 1500 / Math.max(bmp.width, bmp.height));
      const dw = Math.max(1, Math.round(bmp.width * k));
      const dh = Math.max(1, Math.round(bmp.height * k));
      const d = canvas(dw, dh);
      const dctx = d.getContext("2d", { willReadFrequently: true });
      dctx.fillStyle = "#fff";
      dctx.fillRect(0, 0, dw, dh);
      dctx.drawImage(bmp, 0, 0, dw, dh);
      const found = findContentBox(dctx.getImageData(0, 0, dw, dh).data, dw, dh, { pad: 3 });
      if (!found) return { labels: [], skipped: 1 };
      const x = Math.floor(found.x / k);
      const y = Math.floor(found.y / k);
      box = { x, y, w: Math.min(bmp.width - x, Math.ceil(found.w / k)), h: Math.min(bmp.height - y, Math.ceil(found.h / k)) };
    }
    // Never enlarge a picture past its own pixels; only shrink oversized ones to 300 dpi.
    const long = Math.max(box.w, box.h);
    const short = Math.min(box.w, box.h);
    const k = Math.min(1, (LABEL.h * PRINT_DPI) / long, (LABEL.w * PRINT_DPI) / short);
    const w = Math.max(1, Math.round(box.w * k));
    const h = Math.max(1, Math.round(box.h * k));
    const c = canvas(w, h);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, box.x, box.y, box.w, box.h, 0, 0, w, h);
    const label = await finishRaster(c);
    return { labels: [{ id: `l${nextId++}`, name: file.name, pageNo: 1, pageCount: 1, ...label }], skipped: 0 };
  } finally {
    bmp.close();
  }
}

/**
 * Turns a landscape picture a quarter turn clockwise (so every label is
 * upright) and encodes it as PNG.
 * @param {OffscreenCanvas} src
 */
async function finishRaster(src) {
  let out = src;
  if (src.width > src.height) {
    out = canvas(src.height, src.width);
    const ctx = out.getContext("2d");
    ctx.translate(src.height, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(src, 0, 0);
  }
  const blob = await out.convertToBlob({ type: "image/png" });
  const png = new Uint8Array(await blob.arrayBuffer());
  return { raster: { png, w: out.width, h: out.height }, url: URL.createObjectURL(blob) };
}

/** @param {number} w @param {number} h */
function canvas(w, h) {
  return new OffscreenCanvas(w, h);
}
