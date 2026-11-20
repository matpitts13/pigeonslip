// Builds the print-ready PDF: every label at exactly 4 x 6 in, laid out by
// planSheet(). Labels that came from a PDF stay vector (sharp barcodes at any
// printer resolution); images and PDFs pdf-lib can't open use the 300 dpi
// picture instead. pdf-lib is passed in so the same code runs in the window
// (ES module build) and in the Node tests.

import { paginate, placeInSlot, planSheet } from "./layout.js";

const PT = 72; // PDF points per inch
const GUIDE_OFFSET = 3 / PT; // cut guide sits 3 pt outside the label edge

/**
 * @typedef {object} ComposeLabel
 * @property {string} [sourceId] key into `sources` when the label came from a PDF
 * @property {number} [pageIndex] zero-based page in that PDF
 * @property {{left:number,bottom:number,right:number,top:number}} [box] trimmed area, PDF points
 * @property {{png:Uint8Array,w:number,h:number}} raster upright 300 dpi picture of the label
 */

/**
 * @param {any} PDFLib the pdf-lib module namespace
 * @param {ComposeLabel[]} labels
 * @param {{w:number,h:number,margin:number,gap:number}} paper
 * @param {{sources?: Map<string, Uint8Array>, guides?: boolean}} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function composePdf(PDFLib, labels, paper, opts = {}) {
  const { PDFDocument, degrees, rgb } = PDFLib;
  const out = await PDFDocument.create();
  out.setTitle("Shipping labels");
  out.setCreator("Labelsheet");
  out.setProducer("Labelsheet");
  const plan = planSheet(paper);
  if (plan.perSheet < 1) throw new Error("A 4 × 6 in label doesn't fit on this paper.");

  // Each source PDF is parsed once, however many of its pages are used.
  const parsed = new Map();
  async function sourceDoc(id) {
    if (!parsed.has(id)) {
      const bytes = opts.sources?.get(id);
      let doc = null;
      try {
        if (bytes) {
          doc = await PDFDocument.load(bytes, { updateMetadata: false });
          doc.getPageCount(); // pdf-lib parses leniently; this throws if the page tree is missing
        }
      } catch {
        doc = null; // encrypted or damaged: fall back to the picture
      }
      parsed.set(id, doc);
    }
    return parsed.get(id);
  }

  for (const sheetLabels of paginate(labels, plan.perSheet)) {
    const page = out.addPage([paper.w * PT, paper.h * PT]);
    for (let i = 0; i < sheetLabels.length; i++) {
      const label = sheetLabels[i];
      const slot = plan.slots[i];
      const vectorDoc = label.sourceId && label.box ? await sourceDoc(label.sourceId) : null;
      let object = null;
      let contentW;
      let contentH;
      if (vectorDoc && label.pageIndex != null && label.pageIndex < vectorDoc.getPageCount()) {
        const b = label.box;
        try {
          object = await out.embedPage(vectorDoc.getPage(label.pageIndex), b);
          contentW = b.right - b.left;
          contentH = b.top - b.bottom;
        } catch {
          object = null; // a page pdf-lib can't copy: use the picture
        }
      }
      const isVector = object !== null;
      if (!isVector) {
        object = await out.embedPng(label.raster.png);
        contentW = label.raster.w;
        contentH = label.raster.h;
      }
      const spot = placeInSlot(contentW, contentH, slot);
      const draw = { width: spot.drawW * PT, height: spot.drawH * PT, ...anchor(spot, paper), rotate: degrees(-90 * spot.turns) };
      if (isVector) page.drawPage(object, draw);
      else page.drawImage(object, draw);
      if (opts.guides !== false) {
        const g = GUIDE_OFFSET;
        const gx = Math.max(0, slot.x - g);
        const gy = Math.max(0, slot.y - g);
        const gw = Math.min(paper.w, slot.x + slot.w + g) - gx;
        const gh = Math.min(paper.h, slot.y + slot.h + g) - gy;
        page.drawRectangle({
          x: gx * PT,
          y: (paper.h - gy - gh) * PT,
          width: gw * PT,
          height: gh * PT,
          borderColor: rgb(0.6, 0.6, 0.6),
          borderWidth: 0.5,
          borderDashArray: [4, 3],
        });
      }
    }
  }
  return out.save();
}

/**
 * pdf-lib rotates an object about its own bottom-left corner, counter-clockwise
 * for positive angles. Works out that corner so the turned artwork lands on
 * the footprint computed by placeInSlot (top-left origin, inches).
 * @param {{turns:number,x:number,y:number,w:number,h:number}} spot
 * @param {{h:number}} paper
 * @returns {{x:number,y:number}} PDF points, bottom-left origin
 */
export function anchor(spot, paper) {
  const left = spot.x;
  const bottom = paper.h - spot.y - spot.h;
  const top = bottom + spot.h;
  switch (spot.turns) {
    case 1: // quarter turn clockwise: the corner ends up top-left
      return { x: left * PT, y: top * PT };
    case 2: // half turn: the corner ends up top-right
      return { x: (left + spot.w) * PT, y: top * PT };
    default:
      return { x: left * PT, y: bottom * PT };
  }
}
