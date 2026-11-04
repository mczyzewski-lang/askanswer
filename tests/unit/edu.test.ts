import { describe, expect, it } from "vitest";
import { exportFilter, keepRanges, keptDuration, pauseCuts, transcriptSegments, wordGaps, type EduWord } from "../../src/lib/edu";

const w = (text: string, start: number, end: number): EduWord => ({ text, start, end });
const words = [w("Dzień", 0.5, 0.8), w("dobry.", 0.9, 1.3), w("To", 4.0, 4.2), w("wytnij.", 4.3, 4.8), w("Dziś", 5.0, 5.3), w("o", 5.4, 5.5), w("podatkach.", 5.6, 6.2)];

describe("EduStudio", () => {
  it("finds the silences between words (and at the start / end)", () => {
    expect(wordGaps(words, 9)).toEqual([{ start: 1.3, end: 4 }, { start: 6.2, end: 9 }]);
  });
  it("shortens long pauses to 0.5 s and keeps everything else", () => {
    expect(pauseCuts([{ start: 1.3, end: 4 }], 1.2)).toEqual([[1.55, 3.75]]);
    expect(pauseCuts([{ start: 1.3, end: 2.2 }], 1.2)).toEqual([]);
  });
  it("keeps the video minus the enabled cuts and long pauses", () => {
    const cuts = [{ start: 3.9, end: 4.9, enabled: true }, { start: 0.4, end: 1.4, enabled: false }];
    const keep = keepRanges(9, cuts, wordGaps(words, 9), 1.2);
    // a long silence at the end keeps just its 0.25 s of air
    expect(keep).toEqual([[0, 1.55], [4.9, 6.45], [8.75, 9]]);
    expect(keptDuration(keep)).toBeCloseTo(3.35, 2);
  });
  it("splits the transcript into sentences for the analysis", () => {
    const s = transcriptSegments(words);
    expect(s.map((x) => x.text)).toEqual(["Dzień dobry.", "To wytnij.", "Dziś o podatkach."]);
    expect(s[1]).toMatchObject({ from: 2, to: 3, start: 4.0, end: 4.8 });
  });
  it("cuts in one FFmpeg pass, scaling down only when asked and never up", () => {
    const f = exportFilter([[0, 1.5], [4.9, 6.45]], { hasAudio: true, resolution: "720", width: 1920, height: 1080 });
    expect(f).toBe("[0:v]select='between(t,0.000,1.500)+between(t,4.900,6.450)',setpts=N/FRAME_RATE/TB,scale=-2:720,format=yuv420p[v];[0:a]aselect='between(t,0.000,1.500)+between(t,4.900,6.450)',asetpts=N/SR/TB[a]");
    expect(exportFilter([[0, 1]], { hasAudio: false, resolution: "1080", width: 1280, height: 720 })).not.toContain("scale");
  });
});
