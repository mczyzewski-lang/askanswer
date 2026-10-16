import { describe, expect, it } from "vitest";
import { buildInitialDocument } from "../../src/lib/editor/factory";
import { DEFAULT_THEME } from "../../src/lib/themes";
import { infographicOverlay, mergeAutoVisuals } from "../../src/lib/editor/ai-overlays";
import type { AiBrollItem, EditorDocument } from "../../src/lib/editor/types";

const base = () => buildInitialDocument({ questionText: "Q", theme: DEFAULT_THEME, mode: "ANSWER_ONLY", recording: { assetId: "rec", duration: 20 }, segments: [], pauses: [], visibility: "FULL", questionSeconds: 4 });

describe("automatic infographics", () => {
  it("places a full-frame layer for the moment", () => {
    const ov = infographicOverlay({ start: 4, end: 9, title: "t", infographic: { headline: "Ile trwa?", items: [] } }, "img1", 20);
    expect(ov).toMatchObject({ kind: "image", assetId: "img1", start: 4, end: 9, x: 0, y: 0, w: 1, h: 1, fit: "cover" });
  });

  it("merges the AI layers into a document edited meanwhile in the Studio, keeping the edits", () => {
    const local: EditorDocument = base();
    local.meta.questionText = "EDITED LOCALLY";
    const server: EditorDocument = base();
    const ov = infographicOverlay({ start: 4, end: 9, title: "t" }, "img1", 20);
    const item: AiBrollItem = { id: "ai1", kind: "infographic", start: 4, end: 9, quote: "", title: "t", reason: "", prompt: "", duration: 5, model: "m", status: "done", overlayId: ov.id };
    server.overlays = [ov, ...server.overlays];
    server.meta = { ...server.meta, aiBroll: [item], autoVisuals: "done" };
    const merged = mergeAutoVisuals(local, server);
    expect(merged.meta.questionText).toBe("EDITED LOCALLY");
    expect(merged.meta.autoVisuals).toBe("done");
    expect(merged.overlays[0].id).toBe(ov.id);
    expect(merged.meta.aiBroll).toHaveLength(1);
    // idempotent
    expect(mergeAutoVisuals(merged, server)).toBe(merged);
  });
});
