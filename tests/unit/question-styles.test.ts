import { describe, expect, it } from "vitest";
import { buildInitialDocument } from "../../src/lib/editor/factory";
import { DEFAULT_THEME } from "../../src/lib/themes";
import { syncTheme } from "../../src/lib/question-styles";
import type { TextOverlay } from "../../src/lib/editor/types";

const build = (theme = DEFAULT_THEME) =>
  buildInitialDocument({ questionText: "Ile kosztuje rejestracja?", theme, mode: "ANSWER_ONLY", recording: { assetId: "rec", duration: 10 }, segments: [], pauses: [], visibility: "FULL", questionSeconds: 4 });
const question = (doc: ReturnType<typeof build>) => doc.overlays.find((o): o is TextOverlay => o.kind === "text" && o.role === "question")!;

describe("question style from the theme", () => {
  it("new videos use the theme's style and position (default: card at the top)", () => {
    const q = question(build());
    expect(q.style.background).toBe("$primary");
    expect(q.y).toBeCloseTo(0.085);
    const plain = question(build({ ...DEFAULT_THEME, questionStyle: "plain", questionPosition: "center" }));
    expect(plain.style.background).toBeNull();
    expect(plain.y).toBeCloseTo(0.4);
    expect(plain.themeStyle).toBe("plain:center");
  });

  it("a theme change restyles existing videos, keeping text, timing and animation", () => {
    const doc = build();
    const before = question(doc);
    delete before.themeStyle; // made before question styles existed
    syncTheme(doc, { ...DEFAULT_THEME, questionStyle: "accent", questionPosition: "lower" });
    const q = question(doc);
    expect(q.text).toBe(before.text);
    expect(q.start).toBe(before.start);
    expect(q.end).toBe(before.end);
    expect(q.animation).toBe(before.animation);
    expect(q.style.accentBar).toBe(true);
    expect(q.style.background).toBeNull();
    expect(q.y).toBeCloseTo(0.56);
    // untouched when the theme keeps the default and the video was made before
    const old = build();
    delete question(old).themeStyle;
    const ref = question(old);
    syncTheme(old, DEFAULT_THEME);
    expect(question(old)).toBe(ref);
  });
});
