import { describe, expect, it } from "vitest";
import { inHookVersion } from "../../src/lib/editor/timeline";
import { subtitlesHiddenAt } from "../../src/lib/render/compositor";
import type { EditorDocument, Overlay } from "../../src/lib/editor/types";

const video = (p: Partial<Overlay>): Overlay => ({ id: "v", name: "klient", kind: "video", assetId: "a", start: 0, end: 4, opacity: 1, animation: "none", fit: "cover", sourceIn: 0, loop: false, volume: 0, radius: 0, x: 0, y: 0, w: 1, h: 1, ...p }) as Overlay;
const doc = (active: number, overlays: Overlay[]) =>
  ({
    clips: [{ id: "c", assetId: "x", sourceIn: 0, sourceOut: 10, start: 0, volume: 1, muted: false, framing: { scale: 1, cx: 0.5, cy: 0.5 } }],
    narration: [],
    overlays,
    hooks: { clipId: "c", active, variants: [{ id: "hook_0", code: "P01-h01", title: null }, { id: "hook_1", code: "P01-h05", title: null }] },
    meta: {},
  }) as unknown as EditorDocument;

describe("a layer for one hook version", () => {
  it("is part of the edit only while its version is shown", () => {
    const o = video({ hook: "hook_1" });
    expect(inHookVersion(doc(0, [o]), o)).toBe(false);
    expect(inHookVersion(doc(1, [o]), o)).toBe(true);
  });
  it("a layer without a version, or an edit without hook versions, is always shown", () => {
    expect(inHookVersion(doc(0, []), video({}))).toBe(true);
    const solo = { ...doc(0, []), hooks: undefined } as unknown as EditorDocument;
    expect(inHookVersion(solo, video({ hook: "hook_1" }))).toBe(true);
  });
  it("hides the subtitles only in its own version", () => {
    const o = video({ hook: "hook_1", hideSubtitles: true });
    expect(subtitlesHiddenAt(doc(0, [o]), 1)).toBe(false);
    expect(subtitlesHiddenAt(doc(1, [o]), 1)).toBe(true);
  });
});
