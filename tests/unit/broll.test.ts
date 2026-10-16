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

  it("an infographic without rows becomes an illustration (or a video without an image prompt); durations snap to 5/10 s", () => {
    const out = sanitize([{ ...base, kind: "infographic", duration: 8, start: 3, end: 9, infographic: { headline: "x", items: [], note: null } }], 30);
    expect(out[0].kind).toBe("illustration");
    expect(out[0].duration).toBe(10);
    const noImage = sanitize([{ ...base, kind: "illustration", imagePrompt: " ", start: 3, end: 9 }], 30);
    expect(noImage[0].kind).toBe("video");
  });
});

describe("illustrations of the expert's thoughts", () => {
  const seg = (t0: number, t1: number, text: string) => ({ t0, t1, text });
  const segments = [
    seg(0.2, 2.5, "Dzień dobry."),
    seg(2.6, 6, "Sąd rozpatruje tylko to, co napiszesz w pozwie."),
    seg(6.1, 10, "Jeśli czegoś nie wpiszesz, sąd sam tego nie doda."),
    seg(10.1, 14.5, "Dlatego przed złożeniem pozwu zbierz wszystkie dokumenty."),
    seg(14.6, 19, "Rachunki, umowy, wiadomości — wszystko, co pokazuje twoje racje."),
    seg(19.1, 25, "Pamiętaj też o terminach, bo po nich nic już nie zmienisz."),
  ];

  it("groups sentences into passages instead of using single sentences", async () => {
    const { passages, passageFor } = await import("../../src/lib/server/broll");
    const ps = passages(segments, 25);
    expect(ps.length).toBeGreaterThan(0);
    expect(ps.length).toBeLessThan(segments.length);
    expect(ps.every((p) => p.t1 - p.t0 <= 20.5)).toBeTruthy();
    expect(ps[0].text).toContain("Sąd rozpatruje");
    expect(ps[0].text).toContain("sam tego nie doda");
    // context of a moment spans the neighbouring sentences
    const ctx = passageFor(segments, 7, 9);
    expect(ctx).toContain("Sąd rozpatruje");
    expect(ctx).toContain("zbierz wszystkie dokumenty");
  });

  it("asks OpenAI for a full-screen picture of the thought in the theme colours, with only minimal Polish text", async () => {
    const { illustrationPrompt } = await import("../../src/lib/server/broll");
    const { DEFAULT_THEME } = await import("../../src/lib/themes");
    const p = illustrationPrompt({ imagePrompt: "A judge reading a document with missing pages", passage: "Jeśli czegoś nie wpiszesz, sąd sam tego nie doda.", question: "Co wpisać do pozwu?" }, DEFAULT_THEME, false);
    expect(p).toContain("9:16");
    expect(p).toContain("«Jeśli czegoś nie wpiszesz, sąd sam tego nie doda.»");
    expect(p).toContain("A judge reading a document");
    expect(p).toMatch(/one short headline \(max 5 words\)/);
    expect(p).toMatch(/up to 3 thin arrows/);
    expect(p).toMatch(/no paragraphs/);
    for (const hex of [DEFAULT_THEME.background, DEFAULT_THEME.accent, DEFAULT_THEME.highlight, DEFAULT_THEME.text]) expect(p).toContain(hex);
    expect(p).toContain(DEFAULT_THEME.primary);
    expect(p).toMatch(/edge to edge/);
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

  it("the illustration idea shown in the Studio spells out the theme colours and the text rule", async () => {
    const { composeIllustration } = await import("../../src/lib/server/broll");
    const { DEFAULT_THEME } = await import("../../src/lib/themes");
    const p = composeIllustration(null, "A judge reading a document with missing pages.", DEFAULT_THEME);
    expect(p).toContain(`background`);
    expect(p).toContain(DEFAULT_THEME.primary);
    expect(p).toContain(DEFAULT_THEME.accent);
    expect(p).toMatch(/short headline/);
    expect(p).not.toMatch(/no text/i);
  });
});
