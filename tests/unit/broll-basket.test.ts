import { describe, expect, it } from "vitest";
import { buildInitialDocument } from "../../src/lib/editor/factory";
import { DEFAULT_THEME } from "../../src/lib/themes";
import { placeBasketBroll } from "../../src/lib/editor/broll-basket";
import type { AVClip } from "../../src/lib/editor/types";

const reel = () => {
  const doc = buildInitialDocument({ questionText: "T", theme: DEFAULT_THEME, mode: "ANSWER_ONLY", recording: { assetId: "rec", duration: 40 }, segments: [], pauses: [], visibility: "FULL", questionSeconds: 4 });
  const c = (label: string, start: number, len: number): AVClip => ({ ...doc.clips[0], id: label, label, start, sourceIn: start, sourceOut: start + len });
  return { ...doc, clips: [c("HOOK", 0, 3), c("BODY", 3, 20), c("CTA", 23, 4)] };
};
const basket = Array.from({ length: 10 }, (_, i) => ({ id: `frag${i}`, assetId: `b${i % 3}`, sourceIn: i, sourceOut: i + 2.5 }));

describe("B-roll basket in reels", () => {
  it("spreads the cutaways over the body, never over the hook or the CTA, muted and full screen", () => {
    const d = placeBasketBroll(reel(), basket, 3, "P01");
    const cuts = d.overlays.filter((o) => o.id.startsWith("basket_"));
    expect(cuts).toHaveLength(3);
    for (const o of cuts) {
      expect(o.start).toBeGreaterThanOrEqual(3);
      expect(o.end!).toBeLessThanOrEqual(23);
      expect(o).toMatchObject({ kind: "video", volume: 0, fit: "cover", w: 1, h: 1 });
      expect(o.end! - o.start).toBeLessThanOrEqual(3.5);
    }
    // under the title and the other layers
    expect(d.overlays.findIndex((o) => o.id.startsWith("basket_"))).toBe(0);
  });
  it("is random per reel but the same when the reel is laid out again; replaces its earlier cutaways", () => {
    const a = placeBasketBroll(reel(), basket, 3, "P01").overlays.filter((o) => o.id.startsWith("basket_")).map((o) => o.id);
    const again = placeBasketBroll(placeBasketBroll(reel(), basket, 3, "P01"), basket, 3, "P01").overlays.filter((o) => o.id.startsWith("basket_")).map((o) => o.id);
    const other = placeBasketBroll(reel(), basket, 3, "P02").overlays.filter((o) => o.id.startsWith("basket_")).map((o) => o.id);
    expect(again).toEqual(a);
    expect(other).not.toEqual(a);
  });
  it("fits in a short body and does nothing without a basket or when switched off", () => {
    const short = { ...reel(), clips: reel().clips.map((c) => (c.label === "BODY" ? { ...c, sourceOut: c.sourceIn + 5 } : c.label === "CTA" ? { ...c, start: 8 } : c)) };
    expect(placeBasketBroll(short, basket, 4, "P01").overlays.filter((o) => o.id.startsWith("basket_")).length).toBe(0);
    expect(placeBasketBroll(reel(), [], 3, "P01").overlays.filter((o) => o.id.startsWith("basket_")).length).toBe(0);
    expect(placeBasketBroll(reel(), basket, 0, "P01").overlays.filter((o) => o.id.startsWith("basket_")).length).toBe(0);
  });
});
