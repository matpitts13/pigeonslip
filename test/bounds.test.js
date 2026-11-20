import { describe, expect, it } from "vitest";
import { findContentBox } from "../src/shared/bounds.js";

/** White w×h RGBA image with black rectangles drawn in. */
function image(w, h, rects = [], { alpha = 255 } = {}) {
  const px = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let i = 3; i < px.length; i += 4) px[i] = alpha;
  for (const r of rects)
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = (y * w + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = r.v ?? 0;
        px[i + 3] = 255;
      }
  return px;
}

describe("findContentBox", () => {
  it("finds the printed block on a mostly blank page", () => {
    const px = image(100, 120, [{ x: 10, y: 20, w: 40, h: 60 }]);
    expect(findContentBox(px, 100, 120)).toEqual({ x: 10, y: 20, w: 40, h: 60 });
  });

  it("covers several separate marks", () => {
    const px = image(100, 100, [
      { x: 5, y: 5, w: 10, h: 10 },
      { x: 70, y: 80, w: 10, h: 10 },
    ]);
    expect(findContentBox(px, 100, 100)).toEqual({ x: 5, y: 5, w: 75, h: 85 });
  });

  it("returns null for a blank page", () => {
    expect(findContentBox(image(50, 50), 50, 50)).toBeNull();
  });

  it("ignores a single speck of dust", () => {
    const px = image(100, 100, [
      { x: 20, y: 20, w: 30, h: 30 },
      { x: 95, y: 2, w: 1, h: 1 },
    ]);
    expect(findContentBox(px, 100, 100)).toEqual({ x: 20, y: 20, w: 30, h: 30 });
  });

  it("treats near-white as paper and light grey as ink", () => {
    const px = image(60, 60, [
      { x: 0, y: 0, w: 60, h: 60, v: 245 },
      { x: 10, y: 10, w: 5, h: 5, v: 200 },
    ]);
    expect(findContentBox(px, 60, 60)).toEqual({ x: 10, y: 10, w: 5, h: 5 });
  });

  it("treats transparent pixels as paper", () => {
    const px = image(40, 40, [], { alpha: 0 });
    for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = 0; // black but transparent
    expect(findContentBox(px, 40, 40)).toBeNull();
  });

  it("pads the box but never past the edge", () => {
    const px = image(50, 50, [{ x: 1, y: 40, w: 10, h: 10 }]);
    expect(findContentBox(px, 50, 50, { pad: 3 })).toEqual({ x: 0, y: 37, w: 14, h: 13 });
  });
});
