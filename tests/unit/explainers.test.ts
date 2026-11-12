import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { REELS, REEL_FPS, REEL_H, REEL_STYLES, REEL_W } from "../../src/lib/explainers";
import { registerFonts } from "../../src/lib/render/server-render";

describe("Nowy Etap explainers", () => {
  it("beat tables: contiguous, cover the reel, 20-35 s, narration and a visual for every beat", () => {
    expect(REELS.map((r) => [r.n, r.status])).toEqual([[1, "ready"], [2, "ready"], [3, "ready"], [4, "planned"], [5, "planned"], [6, "ready"]]);
    for (const r of REELS) {
      expect(r.duration).toBeGreaterThanOrEqual(20);
      expect(r.duration).toBeLessThanOrEqual(35);
      expect(r.beats[0].start).toBe(0);
      expect(r.beats[r.beats.length - 1].end).toBeCloseTo(r.duration, 5);
      r.beats.forEach((b, i) => {
        if (i) expect(b.start).toBeCloseTo(r.beats[i - 1].end, 5);
        expect(b.vo.trim().length).toBeGreaterThan(5);
        expect(b.visual.trim().length).toBeGreaterThan(10);
        // the narration of a beat fits its time at a calm reading pace (≤ 17 characters / s)
        expect({ reel: r.n, beat: b.id, fits: b.vo.length / (b.end - b.start) <= 17 }).toEqual({ reel: r.n, beat: b.id, fits: true });
      });
      // the brand belief closes every reel that is drawn
      if (r.draw) expect(r.beats.map((b) => b.vo).join(" ")).toMatch(/od planu, nie od pozwu|Najpierw zaplanuj/);
    }
  });

  it("every ready reel draws every sampled frame on the server canvas, starts on cream and ends on the dark green", () => {
    registerFonts();
    expect([REEL_W, REEL_H, REEL_FPS]).toEqual([1080, 1920, 30]);
    const c = createCanvas(REEL_W, REEL_H);
    const g = c.getContext("2d");
    const px = (x: number, y: number) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3));
    expect(REEL_STYLES.map((s) => s.key)).toEqual(["editorial", "papercut", "blueprint", "riso", "campaign"]);
    for (const r of REELS.filter((x) => x.draw)) {
      // every style draws the whole reel; the looks really differ (cream page vs the dark plan)
      for (const s of REEL_STYLES) for (let t = 0; t < r.duration; t += s.key === "editorial" ? 0.37 : 1.3) expect(() => r.draw!(g as never, t, { style: s.key })).not.toThrow();
      r.draw!(g as never, 1, { style: "blueprint" });
      expect(px(60, 960)[0]).toBeLessThan(70);
      r.draw!(g as never, 1, { style: "papercut" });
      expect(px(60, 960)[0]).toBeGreaterThan(180);
      r.draw!(g as never, 0, { style: "editorial" });
      const first = px(40, 1880);
      expect(first[0]).toBeGreaterThan(215);
      r.draw!(g as never, r.duration - 1 / REEL_FPS, { style: "editorial" });
      const last = px(40, 1880);
      expect(last[0]).toBeLessThan(60);
      expect(last[1]).toBeGreaterThan(last[0]);
    }
  }, 120_000);
});
