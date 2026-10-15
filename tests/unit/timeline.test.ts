import { describe, expect, it } from "vitest";
import { buildInitialDocument } from "@/lib/editor/factory";
import { DEFAULT_THEME } from "@/lib/themes";
import { buildSegments, groupWords, toSRT } from "@/lib/editor/subtitles";
import { applyPause, clipAt, deleteRange, docDuration, mapSegmentWords, moveClip, restorePause, sourceToTimeline, splitAt, trimClip, setSegmentText, mergeSegmentWithNext, splitSegmentAtWord } from "@/lib/editor/timeline";
import { suggestZooms, zoomAt, makeZoom } from "@/lib/editor/zoom";
import { detectPauses, computeWaveform } from "@/lib/editor/silence";

const words = [
  { text: "Zastrzeżenie", start: 0.8, end: 1.5 },
  { text: "znaku", start: 1.55, end: 2.0 },
  { text: "towarowego", start: 2.05, end: 2.6 },
  { text: "pozwala", start: 4.7, end: 5.2 },
  { text: "chronić", start: 5.25, end: 6.0 },
  { text: "markę.", start: 6.05, end: 6.9 },
  { text: "To", start: 8.1, end: 8.3 },
  { text: "ważne.", start: 8.35, end: 9.0 },
];

function doc(mode: "CONTINUOUS" | "ANSWER_ONLY" = "ANSWER_ONLY") {
  return buildInitialDocument({
    questionText: "Dlaczego warto zastrzec znak towarowy?",
    theme: DEFAULT_THEME,
    mode,
    recording: { assetId: "rec", duration: 12 },
    narration: { assetId: "tts", duration: 2.5 },
    narrationWindow: mode === "CONTINUOUS" ? { start: 0, end: 2.6 } : null,
    segments: buildSegments("rec", words),
    pauses: [{ start: 2.8, end: 4.5, confidence: 0.9 }],
    visibility: "FULL",
    questionSeconds: 4,
  });
}

describe("composition factory", () => {
  it("mode B puts the narration intro before the answer", () => {
    const d = doc("ANSWER_ONLY");
    expect(d.narration[0].start).toBeCloseTo(0.2);
    expect(d.clips[0].start).toBeGreaterThan(2.5);
    expect(d.overlays[0]).toMatchObject({ kind: "text", role: "question", end: null });
  });
  it("mode A mutes the mic during narration and keeps the reaction footage", () => {
    const d = doc("CONTINUOUS");
    expect(d.clips).toHaveLength(2);
    expect(d.clips[0]).toMatchObject({ muted: true, sourceIn: 0, sourceOut: 2.6 });
    expect(d.clips[1]).toMatchObject({ muted: false, start: 2.6 });
    expect(d.narration[0].start).toBe(0);
  });
});

describe("timeline editing", () => {
  it("split keeps source continuity", () => {
    const d = splitAt(doc(), 6);
    expect(d.clips).toHaveLength(2);
    const [a, b] = [...d.clips].sort((x, y) => x.start - y.start);
    expect(a.sourceOut).toBeCloseTo(b.sourceIn);
    expect(docDuration(d)).toBeCloseTo(docDuration(doc()));
  });
  it("ripple deleteRange removes video and audio together and shifts later items", () => {
    const d0 = doc();
    const off = d0.clips[0].start;
    const d = deleteRange(d0, off + 3, off + 4.5);
    expect(docDuration(d)).toBeCloseTo(docDuration(d0) - 1.5, 2);
    // a source moment after the cut maps 1.5 s earlier; one inside the cut is gone
    expect(sourceToTimeline(d, "rec", 6)).toBeCloseTo(off + 6 - 1.5, 2);
    expect(sourceToTimeline(d, "rec", 3.5)).toBeNull();
    expect(clipAt(d, off + 3.1)?.sourceIn).toBeCloseTo(4.5, 2);
  });
  it("subtitles follow cuts through source mapping (SRT recalculated)", () => {
    const d0 = doc();
    const off = d0.clips[0].start;
    const d = deleteRange(d0, off + 3, off + 4.5);
    const seg = d.subtitles.segments.find((s) => s.words.some((w) => w.text === "pozwala"))!;
    const mapped = mapSegmentWords(d, seg);
    expect(mapped[0].t0).toBeCloseTo(off + 4.7 - 1.5, 2);
    expect(toSRT(d)).toContain("pozwala");
  });
  it("applyPause and restorePause are reversible", () => {
    const d0 = doc();
    const p = d0.pauses[0];
    const cut = applyPause(d0, p.id);
    expect(docDuration(cut)).toBeCloseTo(docDuration(d0) - (p.end - p.start), 2);
    expect(cut.pauses[0].status).toBe("applied");
    const back = restorePause(cut, p.id);
    expect(docDuration(back)).toBeCloseTo(docDuration(d0), 2);
    expect(back.clips).toHaveLength(1);
  });
  it("trim respects source bounds and move avoids overlaps", () => {
    let d = splitAt(doc(), 6);
    const first = [...d.clips].sort((a, b) => a.start - b.start)[0];
    d = trimClip(d, first.id, "start", -5, () => 12);
    expect(d.clips.find((c) => c.id === first.id)!.sourceIn).toBeGreaterThanOrEqual(0);
    const second = [...d.clips].sort((a, b) => a.start - b.start)[1];
    d = moveClip(d, second.id, 1);
    const cl = [...d.clips].sort((a, b) => a.start - b.start);
    expect(cl[1].start).toBeGreaterThanOrEqual(cl[0].start + (cl[0].sourceOut - cl[0].sourceIn) - 1e-6);
  });
  it("subtitle edits never touch the source timing model", () => {
    const d0 = doc();
    const seg = d0.subtitles.segments[0];
    const d = setSegmentText(d0, seg.id, "Ochrona znaku towarowego");
    expect(d.subtitles.segments[0].words.map((w) => w.text).join(" ")).toBe("Ochrona znaku towarowego");
    expect(d.subtitles.source).toBe("edited");
    expect(d.clips).toEqual(d0.clips);
    const merged = mergeSegmentWithNext(d0, seg.id);
    expect(merged.subtitles.segments.length).toBe(d0.subtitles.segments.length - 1);
    const split = splitSegmentAtWord(d0, seg.id, 1);
    expect(split.subtitles.segments.length).toBe(d0.subtitles.segments.length + 1);
  });
});

describe("subtitle grouping", () => {
  it("groups 3–7 words and breaks on sentence ends", () => {
    const g = groupWords(words);
    for (const grp of g) expect(grp.length).toBeLessThanOrEqual(7);
    expect(g.some((grp) => grp[grp.length - 1].text === "markę.")).toBe(true);
  });
});

describe("zoom", () => {
  it("smooth zoom interpolates 100% → 115%", () => {
    const z = makeZoom("smooth-in", 2);
    expect(zoomAt([z], 1.9).scale).toBe(1);
    expect(zoomAt([z], 2).scale).toBeCloseTo(1);
    expect(zoomAt([z], z.end - 0.001).scale).toBeCloseTo(1.15, 2);
    const mid = zoomAt([z], (z.start + z.end) / 2).scale;
    expect(mid).toBeGreaterThan(1.05);
    expect(mid).toBeLessThan(1.1);
  });
  it("suggestions are deterministic and not exported until accepted", () => {
    const d = { ...doc(), clips: [{ ...doc().clips[0], start: 0, sourceIn: 0, sourceOut: 40 }] };
    const a = suggestZooms(d, "standard");
    const b = suggestZooms(d, "standard");
    expect(a.map((z) => [z.start, z.end, z.toScale])).toEqual(b.map((z) => [z.start, z.end, z.toScale]));
    for (const z of a) expect(zoomAt([z], (z.start + z.end) / 2, false).scale).toBe(1);
  });
});

describe("pause detection", () => {
  function wave(regions: Array<[number, number]>, dur: number) {
    const sr = 16000;
    const s = new Float32Array(dur * sr);
    for (let i = 0; i < s.length; i++) {
      const t = i / sr;
      const on = regions.some(([a, b]) => t >= a && t < b);
      s[i] = on ? 0.4 * Math.sin(2 * Math.PI * 200 * t) : 0.0005 * Math.sin(2 * Math.PI * 50 * t);
    }
    return computeWaveform(s, sr);
  }
  it("finds real silent intervals with breathing room", () => {
    const wf = wave([[0.5, 2.6], [4.6, 7], [8, 11.4]], 12);
    const p = detectPauses({ waveform: wf, sensitivity: "standard", padding: 0.2 });
    const mid = p.find((x) => x.start > 2 && x.end < 5)!;
    expect(mid.start).toBeCloseTo(2.8, 1);
    expect(mid.end).toBeCloseTo(4.4, 1);
    // 1 s pause is ignored at standard, found at dynamic
    expect(p.some((x) => x.start > 6.9 && x.end < 8.1)).toBe(false);
    const dyn = detectPauses({ waveform: wf, sensitivity: "dynamic", padding: 0.2 });
    expect(dyn.some((x) => x.start > 6.9 && x.end < 8.1)).toBe(true);
  });
  it("never cuts into transcribed words even when audio is quiet", () => {
    const wf = wave([[0.5, 2.6], [4.6, 7]], 8);
    const p = detectPauses({ waveform: wf, words: [{ start: 3.4, end: 3.7 }], sensitivity: "dynamic", padding: 0.2 });
    for (const x of p) expect(x.end <= 3.4 - 0.19 || x.start >= 3.7 + 0.19).toBe(true);
  });
  it("returns nothing for flat audio", () => {
    expect(detectPauses({ waveform: wave([], 5) })).toEqual([]);
  });
});
