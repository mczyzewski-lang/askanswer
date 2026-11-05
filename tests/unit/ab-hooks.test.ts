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

import { deleteRange } from "../../src/lib/editor/timeline";
import type { AVClip } from "../../src/lib/editor/types";

describe("Ads hook versions with a hook cut in the Studio", () => {
  const d0 = buildInitialDocument({ questionText: "T", theme: DEFAULT_THEME, mode: "ANSWER_ONLY", recording: { assetId: "rec", duration: 60 }, segments: [], pauses: [], visibility: "FULL", questionSeconds: 4 });
  const c = (id: string, label: string, start: number, a: number, b: number): AVClip => ({ ...d0.clips[0], id, label, start, sourceIn: a, sourceOut: b });
  const strip = ({ id: _i, start: _s, ...rest }: AVClip) => (void _i, void _s, rest);
  const doc = { ...d0, clips: [c("h", "HOOK", 0, 10, 14), c("b", "BODY", 4, 20, 30), c("x", "CTA", 14, 40, 43)], hooks: { clipId: "h", active: 0, variants: [{ id: "v0", code: "A", title: "A", clip: strip(c("h", "HOOK", 0, 10, 14)) }, { id: "v1", code: "B", title: "B", clip: strip(c("h", "HOOK", 0, 50, 56)) }] } };
  const shape = (d: { clips: AVClip[] }) => d.clips.map((x) => [x.label, x.start, x.sourceIn, x.sourceOut]);

  it("the whole hook is swapped (no piece of the old one left), the body follows the new length", () => {
    const cut = deleteRange(doc, 1, 2, true); // a pause removed inside hook A → two pieces
    expect(shape(switchHook(cut, 1))).toEqual([["HOOK", 0, 50, 56], ["BODY", 6, 20, 30], ["CTA", 16, 40, 43]]);
  });
  it("each version keeps its own cuts when switching back", () => {
    const cut = deleteRange(doc, 1, 2, true);
    expect(shape(switchHook(switchHook(cut, 1), 0))).toEqual([["HOOK", 0, 10, 11], ["HOOK", 1, 12, 14], ["BODY", 3, 20, 30], ["CTA", 13, 40, 43]]);
  });
});

describe("Ads hook versions on frame-rounded timelines", () => {
  const d0 = buildInitialDocument({ questionText: "T", theme: DEFAULT_THEME, mode: "ANSWER_ONLY", recording: { assetId: "rec", duration: 60 }, segments: [], pauses: [], visibility: "FULL", questionSeconds: 4 });
  const c = (id: string, label: string, start: number, a: number, b: number): AVClip => ({ ...d0.clips[0], id, label, start, sourceIn: a, sourceOut: b });
  const strip = ({ id: _i, start: _s, ...rest }: AVClip) => (void _i, void _s, rest);
  it("the body moves with a longer hook even when it starts a hair before the hook's exact end", () => {
    // hook 2.71 s long, the body laid at the frame 2.7 (81/30) — as buildReels rounds it
    const doc = { ...d0, clips: [c("h", "HOOK", 0, 10, 12.71), c("b", "BODY", 81 / 30, 20, 31.5), c("x", "CTA", 81 / 30 + 11.5, 40, 49.3)], hooks: { clipId: "h", active: 0, variants: [{ id: "v0", code: "A", title: "A", clip: strip(c("h", "HOOK", 0, 10, 12.71)) }, { id: "v1", code: "B", title: "B", clip: strip(c("h", "HOOK", 0, 50, 53.1)) }] } };
    const b = switchHook(doc, 1);
    const [hk, body, cta] = b.clips;
    expect(hk.sourceOut - hk.sourceIn).toBeCloseTo(3.1, 3);
    // no overlap with the hook, no gap before the CTA
    expect(body.start).toBeGreaterThanOrEqual(3.1 - 0.02);
    expect(cta.start).toBeCloseTo(body.start + 11.5, 3);
  });
});
