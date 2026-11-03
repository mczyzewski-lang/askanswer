import { describe, expect, it } from "vitest";
import { buildInitialDocument } from "../../src/lib/editor/factory";
import { DEFAULT_THEME } from "../../src/lib/themes";
import { docDuration, switchHook, withTitleHooks } from "../../src/lib/editor/timeline";
import type { TextOverlay } from "../../src/lib/editor/types";

const title = (d: ReturnType<typeof buildInitialDocument>) => d.overlays.find((o): o is TextOverlay => o.kind === "text" && o.role === "question")!.text;

describe("A/B hooks of one recording", () => {
  it("title only (prompter): the recording stays, the title changes per version", () => {
    const doc = buildInitialDocument({ questionText: "Masz długi?", theme: DEFAULT_THEME, mode: "ANSWER_ONLY", recording: { assetId: "rec", duration: 10 }, segments: [], pauses: [], visibility: "FULL", questionSeconds: 4 });
    const ab = withTitleHooks(doc, [{ text: "Hook lęk" }, { text: "Hook liczba" }]);
    expect(ab.hooks!.variants.map((v) => v.code)).toEqual(["Hook A", "Hook B", "Hook C"]);
    const b = switchHook(ab, 1);
    expect(title(b)).toBe("Hook lęk");
    expect(b.clips).toEqual(ab.clips);
    // an edit of the title in version B is kept when switching back and forth
    const edited = { ...b, overlays: b.overlays.map((o) => (o.kind === "text" && o.role === "question" ? { ...o, text: "Hook lęk (poprawiony)" } : o)) };
    const back = switchHook(switchHook(edited, 0), 1);
    expect(title(switchHook(edited, 0))).toBe("Masz długi?");
    expect(title(back)).toBe("Hook lęk (poprawiony)");
  });

  it("a narration over the expert speaking never cuts into the answer", () => {
    const doc = buildInitialDocument({ questionText: "Pytanie", theme: DEFAULT_THEME, mode: "ANSWER_ONLY", recording: { assetId: "rec", duration: 10 }, segments: [], pauses: [], visibility: "FULL", questionSeconds: 4 });
    const over = { ...doc, narration: [{ id: "n", assetId: "n0", kind: "narration" as const, start: 0, sourceIn: 0, sourceOut: 2, volume: 1, muted: false, fadeIn: 0, fadeOut: 0 }] };
    const b = switchHook(withTitleHooks(over, [{ text: "Krótsze", narration: { assetId: "n1", duration: 1, subs: null } }]), 1);
    expect(b.narration[0].assetId).toBe("n1");
    expect(b.clips).toEqual(over.clips);
  });

  it("with a narrator: each version has its own narration and the answer moves by the length difference", () => {
    const doc = buildInitialDocument({ questionText: "Pytanie", theme: DEFAULT_THEME, mode: "ANSWER_ONLY", recording: { assetId: "rec", duration: 10 }, narration: { assetId: "n0", duration: 3 }, segments: [], pauses: [], visibility: "FULL", questionSeconds: 4 });
    const ab = withTitleHooks(doc, [{ text: "Dłuższe pytanie", narration: { assetId: "n1", duration: 5, subs: { baseAssetId: "n1", segments: [{ id: "s1", assetId: "n1", words: [{ id: "w", text: "Dłuższe", start: 0, end: 1 }] }] } } }]);
    const b = switchHook(ab, 1);
    expect(b.narration[0].assetId).toBe("n1");
    expect(b.narration[0].sourceOut - b.narration[0].sourceIn).toBeCloseTo(5);
    expect(docDuration(b) - docDuration(ab)).toBeCloseTo(2, 1);
    expect(b.subtitles.segments.some((s) => s.assetId === "n1")).toBe(true);
    const a = switchHook(b, 0);
    expect(a.narration[0].assetId).toBe("n0");
    expect(docDuration(a)).toBeCloseTo(docDuration(ab), 1);
    expect(a.subtitles.segments.some((s) => s.assetId === "n1")).toBe(false);
  });
});
