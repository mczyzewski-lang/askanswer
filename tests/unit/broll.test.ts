import { describe, expect, it } from "vitest";
import { sanitize } from "../../src/lib/server/broll";

const base = {
  kind: "video" as const,
  duration: 5,
  quote: "q",
  title: "t",
  reason: "r",
  prompt: "Cinematic shot of a desk",
  imagePrompt: "A desk",
  infographic: { headline: "h", items: [{ value: "1", label: "a" }], note: null },
};

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
    expect(out.every((s) => s.end - s.start >= 1.5)).toBe(true);
  });

  it("falls back to video when an infographic has no rows, and snaps durations to 5/10 s", () => {
    const out = sanitize([{ ...base, kind: "infographic", duration: 8, start: 3, end: 9, infographic: { headline: "x", items: [], note: null } }], 30);
    expect(out[0].kind).toBe("video");
    expect(out[0].duration).toBe(10);
  });
});

describe("style colours", () => {
  it("fills theme colours into a style as plain colour names", async () => {
    const { fillStyle, colorName, INK_EDITORIAL_STYLE } = await import("../../src/lib/broll-style");
    expect(colorName("#0B1F3A")).toContain("blue");
    expect(colorName("#C9A227")).toMatch(/amber|yellow|orange/);
    const filled = fillStyle(INK_EDITORIAL_STYLE, { name: "t", primary: "#0B1F3A", accent: "#C9A227", secondary: "#1E3A5F", text: "#FFFFFF", highlight: "#F5C542", background: "#0A0F1C", questionFont: "Manrope", subtitleFont: "Inter", labelFont: "Inter" });
    expect(filled).not.toMatch(/\{\{/);
    expect(filled).toContain("deep navy blue");
  });
});
