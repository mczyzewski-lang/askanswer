import { describe, expect, it } from "vitest";
import { subtitlesHiddenAt } from "../../src/lib/render/compositor";
import type { EditorDocument, Overlay } from "../../src/lib/editor/types";

const video = (p: Partial<Overlay>): Overlay => ({ id: "v", name: "explainer", kind: "video", assetId: "a", start: 2, end: 5, opacity: 1, animation: "none", fit: "cover", sourceIn: 0, loop: false, volume: 0, radius: 0, x: 0, y: 0, w: 1, h: 1, ...p }) as Overlay;
const doc = (overlays: Overlay[]) => ({ clips: [{ id: "c", assetId: "x", sourceIn: 0, sourceOut: 10, start: 0, volume: 1, muted: false, framing: { scale: 1, cx: 0.5, cy: 0.5 } }], narration: [], overlays, meta: {} }) as unknown as EditorDocument;

describe("no subtitles during a video layer", () => {
  it("hides them only while the flagged layer is on screen", () => {
    const d = doc([video({ hideSubtitles: true })]);
    expect([1.9, 2, 4.9, 5, 7].map((t) => subtitlesHiddenAt(d, t))).toEqual([false, true, true, false, false]);
  });
  it("keeps them for a layer without the flag and for a hidden layer", () => {
    expect(subtitlesHiddenAt(doc([video({})]), 3)).toBe(false);
    expect(subtitlesHiddenAt(doc([video({ hideSubtitles: true, hidden: true })]), 3)).toBe(false);
  });
});
