/**
 * "Wykryj pauzy" — pause detection from real audio energy, refined with word timestamps.
 *
 * 1. Audio decides what is silent: per-window RMS (dBFS) is compared against an
 *    adaptive threshold between the noise floor and the speech level.
 * 2. Word timestamps only refine edges: regions are shrunk so cuts never enter a
 *    word, and a region containing a transcribed word is split around it
 *    (quiet speech is not silence). Missing words alone never create a pause.
 * 3. Breathing room (padding, default 200 ms) is kept on both sides.
 */
import type { Waveform } from "./types";

export type Sensitivity = "gentle" | "standard" | "dynamic";

export const SENSITIVITY: Record<Sensitivity, { label: string; minPause: number; thresholdK: number }> = {
  gentle: { label: "Delikatne cięcia", minPause: 2.0, thresholdK: 0.22 },
  standard: { label: "Standardowe", minPause: 1.2, thresholdK: 0.28 },
  dynamic: { label: "Dynamiczne", minPause: 0.7, thresholdK: 0.34 },
};

export interface DetectedPause {
  start: number;
  end: number;
  confidence: number; // 0..1
  rawStart: number; // silent region before padding
  rawEnd: number;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return -90;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[i];
}

export function detectPauses(input: {
  waveform: Waveform;
  words?: Array<{ start: number; end: number; text?: string }>;
  sensitivity?: Sensitivity;
  padding?: number;
  exclude?: Array<[number, number]>; // e.g. the narration window in continuous mode
  minRemovable?: number;
}): DetectedPause[] {
  const { waveform } = input;
  const sens = SENSITIVITY[input.sensitivity ?? "standard"];
  const padding = input.padding ?? 0.2;
  const minRemovable = input.minRemovable ?? 0.25;
  const rate = waveform.rate;
  const db = waveform.rmsDb;
  if (!db.length) return [];

  const floor = percentile(db, 10);
  const speech = percentile(db, 90);
  const dynamicRange = Math.max(0, speech - floor);
  // a recording with no dynamic range is either all silence or all speech: nothing reliable to cut
  if (dynamicRange < 8) return [];
  const threshold = Math.max(floor + 6, floor + dynamicRange * sens.thresholdK);

  // 1. silent runs, bridging very short blips (< 80 ms) such as clicks
  const silent = db.map((v) => v < threshold);
  const bridge = Math.round(0.08 * rate);
  const runs: Array<[number, number]> = [];
  let i = 0;
  while (i < silent.length) {
    if (!silent[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < silent.length) {
      if (silent[j]) {
        j++;
        continue;
      }
      // look ahead for a short non-silent blip
      let k = j;
      while (k < silent.length && !silent[k] && k - j < bridge) k++;
      if (k < silent.length && silent[k] && k - j < bridge) {
        j = k;
        continue;
      }
      break;
    }
    runs.push([i / rate, j / rate]);
    i = j + 1;
  }

  const words = (input.words ?? []).filter((w) => w.end > w.start).sort((a, b) => a.start - b.start);

  // 2. split runs around transcribed words (quiet speech) and drop excluded windows
  const pieces: Array<[number, number]> = [];
  for (const [a, b] of runs) {
    let segs: Array<[number, number]> = [[a, b]];
    for (const w of words) {
      if (w.end <= a || w.start >= b) continue;
      segs = segs.flatMap(([s, e]) => {
        if (w.end <= s || w.start >= e) return [[s, e]] as Array<[number, number]>;
        const r: Array<[number, number]> = [];
        if (w.start > s) r.push([s, w.start]);
        if (w.end < e) r.push([w.end, e]);
        return r;
      });
    }
    for (const [x0, x1] of input.exclude ?? []) {
      segs = segs.flatMap(([s, e]) => {
        if (x1 <= s || x0 >= e) return [[s, e]] as Array<[number, number]>;
        const r: Array<[number, number]> = [];
        if (x0 > s) r.push([s, x0]);
        if (x1 < e) r.push([x1, e]);
        return r;
      });
    }
    pieces.push(...segs);
  }

  // 3. keep long enough pauses, apply breathing room, never cut into words
  const duration = db.length / rate;
  const out: DetectedPause[] = [];
  for (const [a, b] of pieces) {
    if (b - a < sens.minPause) continue;
    // leading silence before the answer can go entirely (keeping a short lead-in), trailing silence too
    let s = a <= 1 / rate ? 0 : a + padding;
    let e = b >= duration - 1 / rate ? b : b - (a <= 1 / rate ? padding * 1.5 : padding);
    const prevWord = [...words].reverse().find((w) => w.end <= a + 0.05);
    const nextWord = words.find((w) => w.start >= b - 0.05);
    if (prevWord) s = Math.max(s, prevWord.end + padding);
    if (nextWord) e = Math.min(e, nextWord.start - padding);
    if (e - s < minRemovable) continue;
    // confidence: how deep the region is below threshold + whether the transcript agrees
    const from = Math.floor(s * rate);
    const to = Math.min(db.length, Math.ceil(e * rate));
    let sum = 0;
    for (let k = from; k < to; k++) sum += db[k];
    const mean = sum / Math.max(1, to - from);
    const depth = Math.min(1, Math.max(0, (threshold - mean) / 12));
    const transcriptAgrees = words.length ? 1 : 0.6;
    const lengthScore = Math.min(1, (e - s) / (sens.minPause * 2));
    const confidence = Math.round((0.45 * depth + 0.35 * transcriptAgrees + 0.2 * lengthScore) * 100) / 100;
    out.push({ start: round3(s), end: round3(e), confidence, rawStart: round3(a), rawEnd: round3(b) });
  }
  return out;
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

/** Compute peaks + RMS envelope from mono PCM samples. Used on the server from real decoded audio. */
export function computeWaveform(samples: Float32Array, sampleRate: number, rate = 100): Waveform {
  const win = Math.max(1, Math.round(sampleRate / rate));
  const n = Math.ceil(samples.length / win);
  const peaks = new Array<number>(n);
  const rmsDb = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let peak = 0;
    let sq = 0;
    const from = i * win;
    const to = Math.min(samples.length, from + win);
    for (let k = from; k < to; k++) {
      const v = samples[k];
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      sq += v * v;
    }
    const rms = Math.sqrt(sq / Math.max(1, to - from));
    peaks[i] = Math.round(Math.min(1, peak) * 1000) / 1000;
    rmsDb[i] = Math.round((rms > 1e-6 ? 20 * Math.log10(rms) : -120) * 10) / 10;
  }
  return { rate, peaks, rmsDb };
}
