import { describe, expect, it } from "vitest";
import { sanitize } from "../../src/lib/server/broll";

const base = { quote: "q", title: "t", reason: "r", prompt: "Cinematic shot of a desk" };

describe("AI B-roll suggestions", () => {
  it("sorts, clamps to the video and removes overlaps", () => {
    const out = sanitize(
      [
        { ...base, start: 20, end: 26 },
        { ...base, start: 4, end: 9 },
        { ...base, start: 8, end: 12 }, // overlaps the previous one → pushed after it
        { ...base, start: 28, end: 45 }, // past the end → clamped
      ],
      30,
    );
    expect(out.map((s) => [s.start, s.end])).toEqual([
      [4, 9],
      [10, 12],
      [20, 26],
      [28, 30],
    ]);
  });

  it("drops empty prompts and too-short moments", () => {
    const out = sanitize([{ ...base, start: 5, end: 9, prompt: "  " }, { ...base, start: 10, end: 10.5 }], 30);
    expect(out.every((s) => s.end - s.start >= 1.5 && s.prompt.trim())).toBe(true);
  });
});
