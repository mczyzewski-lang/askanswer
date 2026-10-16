import { describe, expect, it } from "vitest";
import { buildInitialDocument } from "../../src/lib/editor/factory";
import { DEFAULT_THEME } from "../../src/lib/themes";
import { mergeAutoPolish } from "../../src/lib/editor/ai-overlays";
import { lookFromStats, parseSignalStats } from "../../src/lib/server/look";
import type { EditorDocument } from "../../src/lib/editor/types";

const base = () => buildInitialDocument({ questionText: "Q", theme: DEFAULT_THEME, mode: "ANSWER_ONLY", recording: { assetId: "rec", duration: 20 }, segments: [], pauses: [], visibility: "FULL", questionSeconds: 4 });

describe("magic picture correction", () => {
  it("lifts a dark, flat, grey recording and barely touches a good one", () => {
    const dull = lookFromStats({ yavg: 55, ylow: 16, yhigh: 120, satavg: 10 });
    const good = lookFromStats({ yavg: 115, ylow: 35, yhigh: 195, satavg: 21 });
    expect(dull.brightness).toBeGreaterThan(1.1);
    expect(dull.saturate).toBeGreaterThan(1.15);
    for (const v of Object.values(good)) expect(Math.abs(v - 1)).toBeLessThan(0.06);
  });

  it("reads FFmpeg signalstats", () => {
    const s = parseSignalStats("frame:0\nlavfi.signalstats.YLOW=28\nlavfi.signalstats.YAVG=76.79\nlavfi.signalstats.YHIGH=158\nlavfi.signalstats.SATAVG=17.01\nframe:1\nlavfi.signalstats.YLOW=30\nlavfi.signalstats.YAVG=80\nlavfi.signalstats.YHIGH=160\nlavfi.signalstats.SATAVG=19\n");
    expect(s).toEqual({ yavg: (76.79 + 80) / 2, ylow: 29, yhigh: 159, satavg: (17.01 + 19) / 2 });
  });
});

describe("automatic finishing merged into an open Studio", () => {
  it("takes blur, voice, picture and zooms from the worker without undoing the user's edits", () => {
    const local: EditorDocument = base();
    local.meta.questionText = "EDITED";
    local.clips[0] = { ...local.clips[0], background: undefined };
    const server: EditorDocument = base();
    server.clips[0] = { ...server.clips[0], background: { blur: 45 }, audioAssetId: "voice", look: { brightness: 1.1, contrast: 1.1, saturate: 1.1 } };
    server.zooms = [{ id: "z", start: 2, end: 4 } as unknown as EditorDocument["zooms"][number]];
    server.meta = { ...server.meta, autoPolish: "p1" };
    const m = mergeAutoPolish(local, server);
    expect(m.meta.questionText).toBe("EDITED");
    expect(m.clips[0].background?.blur).toBe(45);
    expect(m.clips[0].audioAssetId).toBe("voice");
    expect(m.clips[0].look?.brightness).toBe(1.1);
    expect(m.zooms).toHaveLength(1);
    expect(mergeAutoPolish(m, server)).toBe(m);
  });
});
