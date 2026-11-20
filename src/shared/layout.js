// Sheet layout: how many 4x6 labels fit on a sheet of paper, and where each
// one goes. Pure functions, all measurements in inches, origin at the sheet's
// top-left corner. Used by the preview, the print sheets and the saved PDF.

/** Paper sizes the app offers. `margin` keeps labels inside what home printers can reach. */
export const PAPERS = {
  letter: { id: "letter", name: "Letter (8.5 × 11 in)", w: 8.5, h: 11, margin: 0.25, gap: 0.25 },
  a4: { id: "a4", name: "A4 (210 × 297 mm)", w: 210 / 25.4, h: 297 / 25.4, margin: 0.25, gap: 0.25 },
  label4x6: { id: "label4x6", name: "4 × 6 in label roll (thermal)", w: 4, h: 6, margin: 0, gap: 0 },
};

/** The standard USPS shipping label size, portrait. */
export const LABEL = { w: 4, h: 6 };

// Rounding slack so 2 × 4 in labels still count as fitting in exactly 8 in.
const EPS = 1e-6;

/**
 * How many items of `size` fit along `space` with `gap` between them.
 * @param {number} space
 * @param {number} size
 * @param {number} gap
 */
function fitCount(space, size, gap) {
  if (size <= 0 || space + EPS < size) return 0;
  return Math.floor((space + gap + EPS) / (size + gap));
}

/**
 * Plans one sheet: tries the label upright and turned sideways, keeps whichever
 * fits more (upright wins a tie), and centres the grid on the page.
 * @param {{w:number,h:number,margin:number,gap:number}} paper
 * @param {{w:number,h:number}} [label]
 * @returns {{perSheet:number, landscape:boolean, cols:number, rows:number, slotW:number, slotH:number,
 *            slots:{x:number,y:number,w:number,h:number}[]}}
 */
export function planSheet(paper, label = LABEL) {
  const usableW = paper.w - 2 * paper.margin;
  const usableH = paper.h - 2 * paper.margin;
  const options = [false, true].map((landscape) => {
    const slotW = landscape ? label.h : label.w;
    const slotH = landscape ? label.w : label.h;
    const cols = fitCount(usableW, slotW, paper.gap);
    const rows = fitCount(usableH, slotH, paper.gap);
    return { landscape, cols, rows, slotW, slotH, perSheet: cols * rows };
  });
  const best = options[1].perSheet > options[0].perSheet ? options[1] : options[0];
  const gridW = best.cols * best.slotW + Math.max(0, best.cols - 1) * paper.gap;
  const gridH = best.rows * best.slotH + Math.max(0, best.rows - 1) * paper.gap;
  const left = (paper.w - gridW) / 2;
  const top = (paper.h - gridH) / 2;
  const slots = [];
  for (let r = 0; r < best.rows; r++) {
    for (let c = 0; c < best.cols; c++) {
      slots.push({ x: left + c * (best.slotW + paper.gap), y: top + r * (best.slotH + paper.gap), w: best.slotW, h: best.slotH });
    }
  }
  return { ...best, slots };
}

/**
 * Splits labels into sheets of `perSheet`.
 * @template T
 * @param {T[]} items
 * @param {number} perSheet
 * @returns {T[][]}
 */
export function paginate(items, perSheet) {
  if (perSheet < 1) return [];
  const sheets = [];
  for (let i = 0; i < items.length; i += perSheet) sheets.push(items.slice(i, i + perSheet));
  return sheets;
}

/**
 * Where a label's artwork goes inside its slot. The artwork is first turned
 * upright (portrait) if it is wider than tall, then turned again if the slot
 * is sideways, then scaled to fit without distortion and centred.
 * @param {number} contentW artwork width (any unit)
 * @param {number} contentH artwork height (same unit)
 * @param {{x:number,y:number,w:number,h:number}} slot inches
 * @returns {{turns:number, x:number, y:number, w:number, h:number, drawW:number, drawH:number}}
 *   turns: quarter-turns clockwise (0, 1 or 2) applied to the artwork;
 *   x,y,w,h: the footprint on the sheet after turning (inches, top-left origin);
 *   drawW/drawH: the artwork's own size before turning (inches).
 */
export function placeInSlot(contentW, contentH, slot) {
  const contentLandscape = contentW > contentH;
  const slotLandscape = slot.w > slot.h;
  const turns = (contentLandscape ? 1 : 0) + (slotLandscape ? 1 : 0);
  const sideways = turns % 2 === 1;
  const footW0 = sideways ? contentH : contentW;
  const footH0 = sideways ? contentW : contentH;
  const scale = Math.min(slot.w / footW0, slot.h / footH0);
  const w = footW0 * scale;
  const h = footH0 * scale;
  return {
    turns,
    x: slot.x + (slot.w - w) / 2,
    y: slot.y + (slot.h - h) / 2,
    w,
    h,
    drawW: contentW * scale,
    drawH: contentH * scale,
  };
}
