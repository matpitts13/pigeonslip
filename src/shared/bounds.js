// Finds the printed part of a page, so a label that sits on a full letter page
// (TikTok Shop, eBay, Etsy downloads) can be trimmed down to just the label.

/**
 * Bounding box of the non-white pixels in an RGBA buffer.
 * A row or column counts as printed only if it has at least `minInk` dark
 * pixels, so specks of scanner dust or anti-aliasing don't widen the box.
 * @param {Uint8ClampedArray|Uint8Array} rgba
 * @param {number} width
 * @param {number} height
 * @param {{threshold?:number, minInk?:number, pad?:number}} [opts]
 *   threshold: a pixel is "ink" if any channel is below this (0-255);
 *   pad: pixels added around the box (clamped to the image).
 * @returns {{x:number,y:number,w:number,h:number}|null} null for a blank page
 */
export function findContentBox(rgba, width, height, opts = {}) {
  const threshold = opts.threshold ?? 235;
  const minInk = opts.minInk ?? 2;
  const pad = opts.pad ?? 0;
  const rowInk = new Uint32Array(height);
  const colInk = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    let i = y * width * 4;
    for (let x = 0; x < width; x++, i += 4) {
      // Transparent pixels are paper, whatever their colour bytes say.
      if (rgba[i + 3] < 128) continue;
      if (rgba[i] < threshold || rgba[i + 1] < threshold || rgba[i + 2] < threshold) {
        rowInk[y]++;
        colInk[x]++;
      }
    }
  }
  const first = (arr) => arr.findIndex((n) => n >= minInk);
  const last = (arr) => arr.length - 1 - [...arr].reverse().findIndex((n) => n >= minInk);
  const top = first(rowInk);
  const left = first(colInk);
  if (top < 0 || left < 0) return null;
  const bottom = last(rowInk);
  const right = last(colInk);
  const x = Math.max(0, left - pad);
  const y = Math.max(0, top - pad);
  return { x, y, w: Math.min(width, right + 1 + pad) - x, h: Math.min(height, bottom + 1 + pad) - y };
}
