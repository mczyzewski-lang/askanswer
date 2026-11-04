/**
 * EduStudio: an educational video with what should not be in it — remarks for the editor ("to wytnij",
 * "tu wstaw slajd"), retakes, talk off the recording — and over-long pauses, cut out in one FFmpeg pass.
 * Pure helpers shared by the server (analysis, export) and the page (preview of the result).
 */

export interface EduWord {
  text: string;
  start: number;
  end: number;
}

export type EduCutKind = "editor" | "retake" | "offtopic";

export interface EduCut {
  id: string;
  kind: EduCutKind;
  start: number;
  end: number;
  /** what is said there */
  text: string;
  /** why it should go (the AI's reason) */
  reason: string;
  enabled: boolean;
}

export const CUT_LABELS: Record<EduCutKind, { name: string; hint: string }> = {
  editor: { name: "Uwagi dla montażysty", hint: "Polecenia i komentarze do montażu („to wytnij”, „tu wstaw slajd”)." },
  retake: { name: "Powtórki i nieudane podejścia", hint: "Zdania zaczęte od nowa — zostaje ostatnie, dobre podejście." },
  offtopic: { name: "Poza nagraniem", hint: "Rozmowy obok nagrania, sprawdzanie sprzętu („czy nagrywa?”)." },
};

/** Pauses shorter than this are never touched; longer ones keep this much air on each side. */
export const PAUSE_PAD = 0.25;

/** Silences between words (and before the first / after the last word). */
export function wordGaps(words: EduWord[], duration: number, min = 0.6): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let prev = 0;
  for (const w of words) {
    if (w.start - prev >= min) out.push({ start: round(prev), end: round(w.start) });
    prev = Math.max(prev, w.end);
  }
  if (duration - prev >= min) out.push({ start: round(prev), end: round(duration) });
  return out;
}

/** A pause of at least `min` seconds becomes a cut that leaves PAUSE_PAD of silence on each side. */
export function pauseCuts(pauses: Array<{ start: number; end: number }>, min: number): Array<[number, number]> {
  return pauses.filter((p) => p.end - p.start >= min).map((p) => [p.start + PAUSE_PAD, p.end - PAUSE_PAD] as [number, number]).filter(([a, b]) => b - a > 0.05);
}

/** What stays: the whole video minus the enabled cuts and the long pauses (merged, tiny scraps dropped). */
export function keepRanges(duration: number, cuts: Array<Pick<EduCut, "start" | "end" | "enabled">>, pauses: Array<{ start: number; end: number }>, pauseMin: number): Array<[number, number]> {
  const removed: Array<[number, number]> = [...cuts.filter((c) => c.enabled).map((c) => [c.start, c.end] as [number, number]), ...pauseCuts(pauses, pauseMin)]
    .map(([a, b]) => [Math.max(0, a), Math.min(duration, b)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged: Array<[number, number]> = [];
  for (const r of removed) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + 0.05) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  const keep: Array<[number, number]> = [];
  let t = 0;
  for (const [a, b] of merged) {
    if (a - t >= 0.15) keep.push([round(t), round(a)]);
    t = Math.max(t, b);
  }
  if (duration - t >= 0.15) keep.push([round(t), round(duration)]);
  return keep;
}

export const keptDuration = (keep: Array<[number, number]>) => keep.reduce((n, [a, b]) => n + (b - a), 0);

/** Sentences of the transcript (for the analysis): split at a full stop / question mark or a pause, at most ~30 words. */
export function transcriptSegments(words: EduWord[]): Array<{ id: number; start: number; end: number; text: string; from: number; to: number }> {
  const out: Array<{ id: number; start: number; end: number; text: string; from: number; to: number }> = [];
  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    const end = !next || /[.?!…]$/.test(w.text) || next.start - w.end > 0.7 || i - from >= 29;
    if (end) {
      const part = words.slice(from, i + 1);
      out.push({ id: out.length, start: part[0].start, end: part[part.length - 1].end, text: part.map((x) => x.text).join(" "), from, to: i });
      from = i + 1;
    }
  }
  return out;
}

export const fmtTime = (t: number) => {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60).toFixed(1).padStart(4, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

export const EDU_QUALITY = {
  small: { label: "Mały plik", crf: 28, audio: "96k" },
  standard: { label: "Standard (zalecane)", crf: 23, audio: "128k" },
  high: { label: "Wysoka jakość", crf: 19, audio: "160k" },
} as const;
export type EduQuality = keyof typeof EDU_QUALITY;
export const EDU_RESOLUTIONS = { source: "Jak oryginał", "1080": "1080p", "720": "720p" } as const;
export type EduResolution = keyof typeof EDU_RESOLUTIONS;

/**
 * One FFmpeg filter graph keeping only `keep` (a single decode pass — fine for hour-long lectures):
 * select / aselect with the kept ranges, timestamps renumbered, optionally scaled down.
 */
export function exportFilter(keep: Array<[number, number]>, opts: { hasAudio: boolean; resolution: EduResolution; width?: number | null; height?: number | null }): string {
  const expr = keep.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+") || "0";
  const short = Math.min(opts.width ?? 1080, opts.height ?? 1920);
  const target = opts.resolution === "source" ? null : Number(opts.resolution);
  // scale the shorter side down (never up), even sizes for H.264
  const scale = target && short > target ? (opts.width ?? 0) >= (opts.height ?? 0) ? `,scale=-2:${target}` : `,scale=${target}:-2` : "";
  const v = `[0:v]select='${expr}',setpts=N/FRAME_RATE/TB${scale},format=yuv420p[v]`;
  return opts.hasAudio ? `${v};[0:a]aselect='${expr}',asetpts=N/SR/TB[a]` : v;
}

const round = (x: number) => Math.round(x * 1000) / 1000;
