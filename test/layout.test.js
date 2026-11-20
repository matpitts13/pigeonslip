import { describe, expect, it } from "vitest";
import { PAPERS, paginate, placeInSlot, planSheet } from "../src/shared/layout.js";

describe("planSheet", () => {
  it("fits two 4x6 labels on letter, turned sideways and stacked", () => {
    const plan = planSheet(PAPERS.letter);
    expect(plan.perSheet).toBe(2);
    expect(plan.landscape).toBe(true);
    expect(plan.cols).toBe(1);
    expect(plan.rows).toBe(2);
    expect(plan.slots[0]).toEqual({ x: 1.25, y: 1.375, w: 6, h: 4 });
    expect(plan.slots[1]).toEqual({ x: 1.25, y: 5.625, w: 6, h: 4 });
  });

  it("fits two on A4 too", () => {
    expect(planSheet(PAPERS.a4).perSheet).toBe(2);
  });

  it("puts exactly one label on a 4x6 roll with no margin", () => {
    const plan = planSheet(PAPERS.label4x6);
    expect(plan.perSheet).toBe(1);
    expect(plan.landscape).toBe(false);
    expect(plan.slots[0]).toEqual({ x: 0, y: 0, w: 4, h: 6 });
  });

  it("keeps every slot inside the margins and apart by the gap", () => {
    for (const paper of Object.values(PAPERS)) {
      const { slots } = planSheet(paper);
      for (const s of slots) {
        expect(s.x).toBeGreaterThanOrEqual(paper.margin - 1e-9);
        expect(s.y).toBeGreaterThanOrEqual(paper.margin - 1e-9);
        expect(s.x + s.w).toBeLessThanOrEqual(paper.w - paper.margin + 1e-9);
        expect(s.y + s.h).toBeLessThanOrEqual(paper.h - paper.margin + 1e-9);
      }
      for (let i = 0; i < slots.length; i++)
        for (let j = i + 1; j < slots.length; j++) {
          const a = slots[i];
          const b = slots[j];
          const apartX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
          const apartY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
          expect(Math.max(apartX, apartY)).toBeGreaterThanOrEqual(paper.gap - 1e-9);
        }
    }
  });

  it("packs more on big paper (tabloid 11x17: four)", () => {
    expect(planSheet({ w: 11, h: 17, margin: 0.25, gap: 0.25 }).perSheet).toBe(4);
  });

  it("counts a label that exactly fills the space", () => {
    expect(planSheet({ w: 8, h: 6, margin: 0, gap: 0 }).perSheet).toBe(2);
  });

  it("returns zero slots when a label can't fit", () => {
    const plan = planSheet({ w: 3, h: 3, margin: 0, gap: 0 });
    expect(plan.perSheet).toBe(0);
    expect(plan.slots).toEqual([]);
  });
});

describe("paginate", () => {
  it("splits into sheets", () => {
    expect(paginate([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(paginate([], 2)).toEqual([]);
    expect(paginate([1], 0)).toEqual([]);
  });
});

describe("placeInSlot", () => {
  const upright = { x: 0, y: 0, w: 4, h: 6 };
  const sideways = { x: 1, y: 1, w: 6, h: 4 };

  it("fills an upright slot with an upright 2:3 label, no turn", () => {
    expect(placeInSlot(400, 600, upright)).toEqual({ turns: 0, x: 0, y: 0, w: 4, h: 6, drawW: 4, drawH: 6 });
  });

  it("turns an upright label once for a sideways slot", () => {
    const s = placeInSlot(400, 600, sideways);
    expect(s.turns).toBe(1);
    expect(s).toMatchObject({ x: 1, y: 1, w: 6, h: 4, drawW: 4, drawH: 6 });
  });

  it("turns a landscape label upright for an upright slot", () => {
    const s = placeInSlot(600, 400, upright);
    expect(s.turns).toBe(1);
    expect(s).toMatchObject({ w: 4, h: 6, drawW: 6, drawH: 4 });
  });

  it("gives a landscape label two turns in a sideways slot (same as upright, flipped)", () => {
    expect(placeInSlot(600, 400, sideways).turns).toBe(2);
  });

  it("centres a label of another shape without stretching it", () => {
    const s = placeInSlot(100, 100, upright); // square
    expect(s.w).toBeCloseTo(4);
    expect(s.h).toBeCloseTo(4);
    expect(s.y).toBeCloseTo(1);
    expect(s.drawW / s.drawH).toBeCloseTo(1);
  });
});
