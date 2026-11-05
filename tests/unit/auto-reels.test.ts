import { describe, expect, it } from "vitest";
import { candidatesFor, HOOK_MAX, resolvePicks, visualsForLength, type ArSegment } from "../../src/lib/auto-reels";

/** sentences of 5 s with 0.5 s between them; recording 0 has 40, recording 1 has 10 */
function segs(): ArSegment[] {
  const out: ArSegment[] = [];
  for (let src = 0; src < 2; src++) for (let i = 0; i < (src ? 10 : 40); i++) out.push({ id: out.length, src, start: i * 5.5, end: i * 5.5 + 5, text: `Zdanie ${src}.${i}.` });
  return out;
}
const opts = { count: 10, min: 20, max: 60 };

describe("Auto Reels: resolving the AI's picks", () => {
  it("a teaser hook from later + the passage from the start of the thought", () => {
    const [c] = resolvePicks(segs(), [{ hook_from: 8, hook_to: 8, from: 4, to: 9, title: "Tytuł", score: 80, reason: "bo" }], opts);
    expect(c.hook).toEqual([44, 49]);
    expect(c.body).toEqual([22, 54.5]);
    expect(c.duration).toBeCloseTo(5 + 32.5);
    expect(c).toMatchObject({ title: "Tytuł", score: 80, src: 0 });
  });

  it("a hook opening the passage is said once: the passage goes on after it", () => {
    const [c] = resolvePicks(segs(), [{ hook_from: 4, hook_to: 4, from: 4, to: 9, score: 70 }], opts);
    expect(c.hook).toEqual([22, 27]);
    expect(c.body[0]).toBe(27.5);
  });

  it("too short → stretched by the next sentences; too long → trimmed by whole sentences", () => {
    const [short] = resolvePicks(segs(), [{ hook_from: 2, hook_to: 2, from: 3, to: 3, score: 50 }], opts);
    expect(short.duration).toBeGreaterThanOrEqual(20);
    const [long] = resolvePicks(segs(), [{ hook_from: 2, hook_to: 2, from: 3, to: 30, score: 50 }], opts);
    expect(long.duration).toBeLessThanOrEqual(60);
    expect(long.duration).toBeGreaterThan(50);
  });

  it("a long hook is cut to its first sentences", () => {
    const [c] = resolvePicks(segs(), [{ hook_from: 10, hook_to: 14, from: 15, to: 18, score: 50 }], opts);
    expect(c.hook[1] - c.hook[0]).toBeLessThanOrEqual(HOOK_MAX);
  });

  it("best first, the same passage only once, never across two recordings, at most `count`", () => {
    const r = resolvePicks(
      segs(),
      [
        { hook_from: 5, from: 5, to: 9, score: 40 },
        { hook_from: 6, from: 5, to: 9, score: 90 },
        { hook_from: 38, from: 39, to: 42, score: 99 }, // reaches into the second recording
        { hook_from: 41, from: 42, to: 46, score: 70 },
        { hook_from: 20, from: 20, to: 25, score: 60 },
        { hook_from: 999, from: 1, to: 2, score: 100 },
      ],
      { ...opts, count: 2 },
    );
    expect(r.map((c) => c.score)).toEqual([90, 70]);
    expect(r[1].src).toBe(1);
  });

  it("graphics by length and candidates per window", () => {
    expect([20, 45, 80, 120].map(visualsForLength)).toEqual([1, 1, 2, 3]);
    expect(candidatesFor(1200, 3600, 25)).toBe(14);
    expect(candidatesFor(10, 3600, 25)).toBe(3);
  });
});
