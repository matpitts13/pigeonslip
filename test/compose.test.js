import * as PDFLib from "pdf-lib";
import { describe, expect, it } from "vitest";
import { anchor, composePdf } from "../src/shared/compose.js";
import { PAPERS } from "../src/shared/layout.js";

const { PDFDocument, rgb } = PDFLib;

/** A letter-size source PDF with a 4x6-ish block drawn on each page. */
async function sourcePdf(pages = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([612, 792]);
    p.drawRectangle({ x: 30, y: 20, width: 513, height: 770, color: rgb(0, 0, 0) });
  }
  return doc.save();
}

// 1×1 white PNG.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);
const raster = { png: PNG, w: 2, h: 3 };

describe("composePdf", () => {
  it("lays out vector labels two to a letter page", async () => {
    const src = await sourcePdf(3);
    const sources = new Map([["s1", src]]);
    const box = { left: 30, bottom: 20, right: 543, top: 790 };
    const labels = [0, 1, 2].map((i) => ({ sourceId: "s1", pageIndex: i, box, raster }));
    const out = await PDFDocument.load(await composePdf(PDFLib, labels, PAPERS.letter, { sources }));
    expect(out.getPageCount()).toBe(2);
    expect(out.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    expect(out.getTitle()).toBe("Shipping labels");
  });

  it("uses the picture when there is no source PDF", async () => {
    const out = await PDFDocument.load(await composePdf(PDFLib, [{ raster }], PAPERS.label4x6));
    expect(out.getPageCount()).toBe(1);
    expect(out.getPage(0).getSize()).toEqual({ width: 288, height: 432 });
  });

  it("falls back to the picture when the source PDF is damaged", async () => {
    const sources = new Map([["bad", new TextEncoder().encode("%PDF-1.7 garbage")]]);
    const label = { sourceId: "bad", pageIndex: 0, box: { left: 0, bottom: 0, right: 10, top: 10 }, raster };
    const out = await PDFDocument.load(await composePdf(PDFLib, [label], PAPERS.letter, { sources }));
    expect(out.getPageCount()).toBe(1);
  });

  it("refuses paper a label can't fit on", async () => {
    await expect(composePdf(PDFLib, [{ raster }], { w: 3, h: 3, margin: 0, gap: 0 })).rejects.toThrow(/doesn't fit/);
  });
});

describe("anchor", () => {
  const paper = { h: 11 };
  const spot = { x: 1, y: 2, w: 6, h: 4 };
  it("no turn: bottom-left corner of the footprint", () => {
    expect(anchor({ ...spot, turns: 0 }, paper)).toEqual({ x: 72, y: (11 - 2 - 4) * 72 });
  });
  it("quarter turn: top-left corner", () => {
    expect(anchor({ ...spot, turns: 1 }, paper)).toEqual({ x: 72, y: (11 - 2) * 72 });
  });
  it("half turn: top-right corner", () => {
    expect(anchor({ ...spot, turns: 2 }, paper)).toEqual({ x: 7 * 72, y: (11 - 2) * 72 });
  });
});
