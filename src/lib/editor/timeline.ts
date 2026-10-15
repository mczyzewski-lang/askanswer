/**
 * Pure timeline operations. Every function returns a new document; the input is
 * never mutated, which makes undo/redo a matter of keeping old references.
 */
import type { AVClip, AudioClip, EditorDocument, Overlay, SubtitleSegment, SubWord, ZoomEffect } from "./types";
import { uid } from "./id";

export const EPS = 1e-4;
export const MIN_CLIP = 1 / 30;

export function snapToFrame(t: number, fps: number): number {
  return Math.round(t * fps) / fps;
}

export function clipEnd(c: { start: number; sourceIn: number; sourceOut: number }): number {
  return c.start + (c.sourceOut - c.sourceIn);
}

export function docDuration(doc: EditorDocument): number {
  let d = 0;
  for (const c of doc.clips) d = Math.max(d, clipEnd(c));
  for (const c of doc.narration) d = Math.max(d, clipEnd(c));
  return d;
}

export function overlayEnd(o: Overlay, duration: number): number {
  return o.end == null ? duration : Math.min(o.end, duration);
}

export function sortedClips(doc: EditorDocument): AVClip[] {
  return [...doc.clips].sort((a, b) => a.start - b.start);
}

/** The AV clip visible at timeline time t (topmost = latest start wins). */
export function clipAt(doc: EditorDocument, t: number): AVClip | null {
  let found: AVClip | null = null;
  for (const c of doc.clips) {
    if (t >= c.start - EPS && t < clipEnd(c) - EPS) {
      if (!found || c.start > found.start) found = c;
    }
  }
  return found;
}

export function audioClipAt(list: AudioClip[], t: number): AudioClip | null {
  for (const c of list) if (t >= c.start && t < clipEnd(c)) return c;
  return null;
}

/** Source time -> timeline time through the AV clips. Returns null if the source moment was cut out. */
export function sourceToTimeline(doc: EditorDocument, assetId: string, src: number): number | null {
  let best: number | null = null;
  for (const c of doc.clips) {
    if (c.assetId !== assetId) continue;
    if (src >= c.sourceIn - EPS && src < c.sourceOut + EPS) {
      const t = c.start + (src - c.sourceIn);
      if (best === null || t < best) best = t;
    }
  }
  return best;
}

/** Timeline time -> (asset, source time). */
export function timelineToSource(doc: EditorDocument, t: number): { assetId: string; src: number; clip: AVClip } | null {
  const c = clipAt(doc, t);
  if (!c) return null;
  return { assetId: c.assetId, src: c.sourceIn + (t - c.start), clip: c };
}

/** Source range -> list of timeline ranges (a range can be split by cuts). */
export function sourceRangeToTimeline(doc: EditorDocument, assetId: string, a: number, b: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const c of doc.clips) {
    if (c.assetId !== assetId) continue;
    const s = Math.max(a, c.sourceIn);
    const e = Math.min(b, c.sourceOut);
    if (e - s > EPS) out.push([c.start + (s - c.sourceIn), c.start + (e - c.sourceIn)]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

export interface TimedWord extends SubWord {
  segId: string;
  t0: number; // timeline
  t1: number;
}

/**
 * Subtitle words mapped onto the timeline. Words whose audio was cut are dropped;
 * words partially cut are clamped. This is what keeps subtitles in sync after edits.
 */
export function mapSegmentWords(doc: EditorDocument, seg: SubtitleSegment): TimedWord[] {
  const res: TimedWord[] = [];
  for (const w of seg.words) {
    const ranges = sourceRangeToTimeline(doc, seg.assetId, w.start, Math.max(w.end, w.start + 0.02));
    if (!ranges.length) continue;
    const [t0] = ranges[0];
    const t1 = ranges[ranges.length - 1][1];
    // a word whose audio was cut in the middle is still shown on its first surviving range
    res.push({ ...w, segId: seg.id, t0, t1: Math.max(t1, t0 + 0.02) });
  }
  return res;
}

export interface TimedSegment {
  seg: SubtitleSegment;
  words: TimedWord[];
  t0: number;
  t1: number;
}

export function timedSegments(doc: EditorDocument): TimedSegment[] {
  const out: TimedSegment[] = [];
  for (const seg of doc.subtitles.segments) {
    const words = mapSegmentWords(doc, seg);
    if (!words.length) continue;
    out.push({ seg, words, t0: words[0].t0, t1: words[words.length - 1].t1 });
  }
  out.sort((a, b) => a.t0 - b.t0);
  // keep a segment on screen through short gaps until the next one starts
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    const hold = next ? Math.min(next.t0, out[i].t1 + 0.6) : out[i].t1 + 0.6;
    out[i] = { ...out[i], t1: Math.max(out[i].t1, hold) };
  }
  return out;
}

export function segmentAt(segs: TimedSegment[], t: number): TimedSegment | null {
  for (const s of segs) if (t >= s.t0 && t < s.t1) return s;
  return null;
}

// ---------------------------------------------------------------------------
// Editing operations
// ---------------------------------------------------------------------------

function splitAVClip(c: AVClip, t: number): [AVClip, AVClip] | null {
  const rel = t - c.start;
  if (rel <= MIN_CLIP / 2 || rel >= c.sourceOut - c.sourceIn - MIN_CLIP / 2) return null;
  const cut = c.sourceIn + rel;
  return [
    { ...c, sourceOut: cut },
    { ...c, id: uid("clip"), sourceIn: cut, start: t },
  ];
}

function splitAudioClip(c: AudioClip, t: number): [AudioClip, AudioClip] | null {
  const rel = t - c.start;
  if (rel <= MIN_CLIP / 2 || rel >= c.sourceOut - c.sourceIn - MIN_CLIP / 2) return null;
  const cut = c.sourceIn + rel;
  return [
    { ...c, sourceOut: cut, fadeOut: 0 },
    { ...c, id: uid("aud"), sourceIn: cut, start: t, fadeIn: 0 },
  ];
}

/** Split the clip with the given id (or the AV clip under the playhead) at t. */
export function splitAt(doc: EditorDocument, t: number, clipId?: string): EditorDocument {
  t = snapToFrame(t, doc.fps);
  const avTarget = clipId ? doc.clips.find((c) => c.id === clipId) : clipAt(doc, t);
  if (avTarget) {
    const parts = splitAVClip(avTarget, t);
    if (!parts) return doc;
    return { ...doc, clips: doc.clips.flatMap((c) => (c.id === avTarget.id ? parts : [c])) };
  }
  for (const key of ["narration", "music"] as const) {
    const target = doc[key].find((c) => c.id === clipId);
    if (target) {
      const parts = splitAudioClip(target, t);
      if (!parts) return doc;
      return { ...doc, [key]: doc[key].flatMap((c) => (c.id === target.id ? parts : [c])) };
    }
  }
  return doc;
}

function shiftAfter(t: number, a: number, b: number): number {
  // maps a timeline time after removing [a,b)
  if (t <= a) return t;
  if (t >= b) return t - (b - a);
  return a;
}

function cutAV(clips: AVClip[], a: number, b: number, ripple: boolean): AVClip[] {
  const out: AVClip[] = [];
  const len = b - a;
  for (const c of clips) {
    const ce = clipEnd(c);
    if (ce <= a + EPS) {
      out.push(c);
      continue;
    }
    if (c.start >= b - EPS) {
      out.push(ripple ? { ...c, start: c.start - len } : c);
      continue;
    }
    // overlaps the cut
    if (c.start < a - EPS) out.push({ ...c, sourceOut: c.sourceIn + (a - c.start) });
    if (ce > b + EPS) {
      const srcIn = c.sourceIn + (b - c.start);
      out.push({ ...c, id: c.start < a - EPS ? uid("clip") : c.id, sourceIn: srcIn, start: ripple ? a : b });
    }
  }
  return out.filter((c) => c.sourceOut - c.sourceIn > EPS);
}

function cutAudio(clips: AudioClip[], a: number, b: number, ripple: boolean): AudioClip[] {
  const out: AudioClip[] = [];
  const len = b - a;
  for (const c of clips) {
    const ce = clipEnd(c);
    if (ce <= a + EPS) out.push(c);
    else if (c.start >= b - EPS) out.push(ripple ? { ...c, start: c.start - len } : c);
    else {
      if (c.start < a - EPS) out.push({ ...c, sourceOut: c.sourceIn + (a - c.start) });
      if (ce > b + EPS) out.push({ ...c, id: c.start < a - EPS ? uid("aud") : c.id, sourceIn: c.sourceIn + (b - c.start), start: ripple ? a : b });
    }
  }
  return out.filter((c) => c.sourceOut - c.sourceIn > EPS);
}

/**
 * Remove the timeline range [a, b). With ripple, everything after the range moves
 * left so no gap is left. Video and expert audio are cut together (linked clips),
 * so they stay in sync; subtitles follow automatically through source mapping.
 */
export function deleteRange(doc: EditorDocument, a: number, b: number, ripple = true, opts: { music?: boolean } = {}): EditorDocument {
  a = snapToFrame(Math.max(0, Math.min(a, b)), doc.fps);
  b = snapToFrame(Math.max(a, b), doc.fps);
  if (b - a < EPS) return doc;
  const duration = docDuration(doc);
  const len = b - a;
  const zooms: ZoomEffect[] = [];
  for (const z of doc.zooms) {
    if (z.end <= a) zooms.push(z);
    else if (z.start >= b) zooms.push(ripple ? { ...z, start: z.start - len, end: z.end - len } : z);
    else {
      const ns = ripple ? shiftAfter(z.start, a, b) : z.start;
      const ne = ripple ? shiftAfter(z.end, a, b) : z.end;
      if (ne - ns > 0.2) zooms.push({ ...z, start: ns, end: ne });
    }
  }
  const overlays: Overlay[] = [];
  for (const o of doc.overlays) {
    const oe = o.end == null ? null : o.end;
    if (!ripple) {
      overlays.push(o);
      continue;
    }
    const ns = shiftAfter(o.start, a, b);
    const ne = oe == null ? null : shiftAfter(oe, a, b);
    if (ne != null && ne - ns < 0.05 && !(o.end == null || o.end >= duration)) continue;
    overlays.push({ ...o, start: ns, end: ne });
  }
  return {
    ...doc,
    clips: cutAV(doc.clips, a, b, ripple),
    narration: cutAudio(doc.narration, a, b, ripple),
    // background music keeps playing continuously by default — only shifted, never chopped
    music: opts.music ? cutAudio(doc.music, a, b, ripple) : doc.music,
    zooms,
    overlays,
  };
}

/** Delete a single clip, optionally rippling the timeline. */
export function deleteClip(doc: EditorDocument, id: string, ripple: boolean): EditorDocument {
  const av = doc.clips.find((c) => c.id === id);
  if (av) {
    if (ripple) return deleteRange(doc, av.start, clipEnd(av), true);
    return { ...doc, clips: doc.clips.filter((c) => c.id !== id) };
  }
  if (doc.narration.some((c) => c.id === id)) return { ...doc, narration: doc.narration.filter((c) => c.id !== id) };
  if (doc.music.some((c) => c.id === id)) return { ...doc, music: doc.music.filter((c) => c.id !== id) };
  if (doc.zooms.some((z) => z.id === id)) return { ...doc, zooms: doc.zooms.filter((z) => z.id !== id) };
  if (doc.overlays.some((o) => o.id === id)) return { ...doc, overlays: doc.overlays.filter((o) => o.id !== id) };
  return doc;
}

/** Trim the left or right edge of an AV/audio clip to timeline time t, respecting source bounds. */
export function trimClip(
  doc: EditorDocument,
  id: string,
  edge: "start" | "end",
  t: number,
  sourceDuration: (assetId: string) => number,
): EditorDocument {
  t = snapToFrame(t, doc.fps);
  const apply = <C extends AVClip | AudioClip>(c: C): C => {
    const dur = sourceDuration(c.assetId);
    if (edge === "start") {
      const maxStart = clipEnd(c) - MIN_CLIP;
      let ns = Math.min(t, maxStart);
      let nIn = c.sourceIn + (ns - c.start);
      if (nIn < 0) {
        ns -= nIn;
        nIn = 0;
      }
      if (ns < 0) {
        nIn -= ns;
        ns = 0;
      }
      return { ...c, start: ns, sourceIn: nIn };
    }
    const minEnd = c.start + MIN_CLIP;
    const ne = Math.max(t, minEnd);
    const nOut = Math.min(dur, c.sourceIn + (ne - c.start));
    return { ...c, sourceOut: nOut };
  };
  if (doc.clips.some((c) => c.id === id)) {
    const clips = doc.clips.map((c) => (c.id === id ? apply(c) : c));
    return { ...doc, clips: resolveOverlaps(clips, id) };
  }
  for (const key of ["narration", "music"] as const) {
    if (doc[key].some((c) => c.id === id)) return { ...doc, [key]: doc[key].map((c) => (c.id === id ? apply(c) : c)) };
  }
  return doc;
}

/** Keep the main AV track free of overlaps: the edited clip wins and neighbours are clamped. */
function resolveOverlaps(clips: AVClip[], winnerId: string): AVClip[] {
  const w = clips.find((c) => c.id === winnerId);
  if (!w) return clips;
  const ws = w.start;
  const we = clipEnd(w);
  return clips
    .flatMap((c) => {
      if (c.id === winnerId) return [c];
      const cs = c.start;
      const ce = clipEnd(c);
      if (ce <= ws + EPS || cs >= we - EPS) return [c];
      const parts: AVClip[] = [];
      if (cs < ws) parts.push({ ...c, sourceOut: c.sourceIn + (ws - cs) });
      if (ce > we) parts.push({ ...c, id: cs < ws ? uid("clip") : c.id, sourceIn: c.sourceIn + (we - cs), start: we });
      return parts;
    })
    .filter((c) => c.sourceOut - c.sourceIn > MIN_CLIP / 2);
}

/** Move a clip to a new start time. AV clips cannot overlap other AV clips (they are clamped into the free gap). */
export function moveClip(doc: EditorDocument, id: string, newStart: number): EditorDocument {
  newStart = snapToFrame(Math.max(0, newStart), doc.fps);
  const av = doc.clips.find((c) => c.id === id);
  if (av) {
    const len = av.sourceOut - av.sourceIn;
    const others = sortedClips(doc).filter((c) => c.id !== id);
    // find the gap that contains the desired position closest to newStart
    const gaps: Array<[number, number]> = [];
    let cursor = 0;
    for (const o of others) {
      if (o.start - cursor >= len - EPS) gaps.push([cursor, o.start - len]);
      cursor = Math.max(cursor, clipEnd(o));
    }
    gaps.push([cursor, Number.POSITIVE_INFINITY]);
    let best = newStart;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const [g0, g1] of gaps) {
      const s = Math.min(Math.max(newStart, g0), g1);
      const d = Math.abs(s - newStart);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
    return { ...doc, clips: doc.clips.map((c) => (c.id === id ? { ...c, start: snapToFrame(best, doc.fps) } : c)) };
  }
  for (const key of ["narration", "music"] as const) {
    if (doc[key].some((c) => c.id === id)) return { ...doc, [key]: doc[key].map((c) => (c.id === id ? { ...c, start: newStart } : c)) };
  }
  const z = doc.zooms.find((x) => x.id === id);
  if (z) {
    const len = z.end - z.start;
    return { ...doc, zooms: doc.zooms.map((x) => (x.id === id ? { ...x, start: newStart, end: newStart + len } : x)) };
  }
  const o = doc.overlays.find((x) => x.id === id);
  if (o) {
    const len = o.end == null ? null : o.end - o.start;
    return { ...doc, overlays: doc.overlays.map((x) => (x.id === id ? { ...x, start: newStart, end: len == null ? null : newStart + len } : x)) };
  }
  return doc;
}

/** Close all gaps on the main track (used after reordering). */
export function packClips(doc: EditorDocument): EditorDocument {
  let cursor = 0;
  const clips = sortedClips(doc).map((c) => {
    const n = { ...c, start: cursor };
    cursor = clipEnd(n);
    return n;
  });
  return { ...doc, clips };
}

/** Remove the source range of a pause suggestion from the timeline. */
export function applyPause(doc: EditorDocument, pauseId: string): EditorDocument {
  const p = doc.pauses.find((x) => x.id === pauseId);
  if (!p || p.status === "applied") return doc;
  const ranges = sourceRangeToTimeline(doc, p.assetId, p.start, p.end);
  let next = doc;
  // delete from the end so earlier ranges keep their positions
  for (const [a, b] of [...ranges].reverse()) next = deleteRange(next, a, b, true);
  return { ...next, pauses: next.pauses.map((x) => (x.id === pauseId ? { ...x, status: "applied" as const } : x)) };
}

export function applyAcceptedPauses(doc: EditorDocument): EditorDocument {
  // apply later pauses first (in timeline order) so ranges don't shift under us
  const accepted = doc.pauses
    .filter((p) => p.status === "accepted")
    .map((p) => ({ p, t: sourceToTimeline(doc, p.assetId, p.start) ?? -1 }))
    .sort((a, b) => b.t - a.t);
  let next = doc;
  for (const { p } of accepted) next = applyPause(next, p.id);
  return next;
}

/**
 * Restore a previously applied pause: re-inserts the source range in the clip it
 * belonged to (ripple-inserting time). This makes silence cuts reversible.
 */
export function restorePause(doc: EditorDocument, pauseId: string): EditorDocument {
  const p = doc.pauses.find((x) => x.id === pauseId);
  if (!p || p.status !== "applied") return doc;
  const clips = sortedClips(doc);
  // find adjacent clips of the same asset where left.sourceOut ≈ p.start-ish and right.sourceIn ≈ p.end-ish
  for (let i = 0; i < clips.length - 1; i++) {
    const L = clips[i];
    const R = clips[i + 1];
    if (L.assetId !== p.assetId || R.assetId !== p.assetId) continue;
    if (L.sourceOut <= p.start + 0.05 && L.sourceOut >= p.start - 0.5 && R.sourceIn >= p.end - 0.05 && R.sourceIn <= p.end + 0.5) {
      const insertAt = clipEnd(L);
      const gap = R.sourceIn - L.sourceOut;
      const merged: AVClip = { ...L, sourceOut: R.sourceOut };
      const shift = <T extends { start: number }>(x: T): T => (x.start >= insertAt - EPS ? { ...x, start: x.start + gap } : x);
      return {
        ...doc,
        clips: doc.clips.filter((c) => c.id !== R.id).map((c) => (c.id === L.id ? merged : shift(c))),
        narration: doc.narration.map(shift),
        music: doc.music.map(shift),
        zooms: doc.zooms.map((z) => (z.start >= insertAt - EPS ? { ...z, start: z.start + gap, end: z.end + gap } : z)),
        overlays: doc.overlays.map((o) =>
          o.start >= insertAt - EPS
            ? { ...o, start: o.start + gap, end: o.end == null ? null : o.end + gap }
            : o.end != null && o.end > insertAt
              ? { ...o, end: o.end + gap }
              : o,
        ),
        pauses: doc.pauses.map((x) => (x.id === pauseId ? { ...x, status: "pending" as const } : x)),
      };
    }
  }
  return doc;
}

/** Duplicate-free list of cut points on the main track (timeline times where the source jumps). */
export function cutPoints(doc: EditorDocument): number[] {
  const cl = sortedClips(doc);
  const pts: number[] = [];
  for (let i = 1; i < cl.length; i++) {
    const prev = cl[i - 1];
    const cur = cl[i];
    if (prev.assetId !== cur.assetId || Math.abs(prev.sourceOut - cur.sourceIn) > 0.02) pts.push(cur.start);
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Subtitle editing (operates on the editable copy, never the original transcript)
// ---------------------------------------------------------------------------

export function updateWord(doc: EditorDocument, segId: string, wordId: string, patch: Partial<SubWord>): EditorDocument {
  return {
    ...doc,
    subtitles: {
      ...doc.subtitles,
      source: "edited",
      segments: doc.subtitles.segments.map((s) =>
        s.id !== segId ? s : { ...s, words: s.words.map((w) => (w.id === wordId ? { ...w, ...patch } : w)) },
      ),
    },
  };
}

/** Replace the text of a whole segment. Word timings are redistributed over the original span. */
export function setSegmentText(doc: EditorDocument, segId: string, text: string): EditorDocument {
  const seg = doc.subtitles.segments.find((s) => s.id === segId);
  if (!seg) return doc;
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return deleteSegment(doc, segId);
  const old = seg.words;
  let words: SubWord[];
  if (tokens.length === old.length) {
    words = old.map((w, i) => ({ ...w, text: tokens[i] }));
  } else {
    const s0 = old[0]?.start ?? 0;
    const s1 = old[old.length - 1]?.end ?? s0 + tokens.length * 0.3;
    const totalChars = tokens.reduce((n, t) => n + t.length + 1, 0);
    let cursor = s0;
    words = tokens.map((tok) => {
      const d = ((tok.length + 1) / totalChars) * (s1 - s0);
      const w = { id: uid("w"), text: tok, start: cursor, end: cursor + d };
      cursor += d;
      return w;
    });
  }
  return {
    ...doc,
    subtitles: { ...doc.subtitles, source: "edited", segments: doc.subtitles.segments.map((s) => (s.id === segId ? { ...s, words } : s)) },
  };
}

export function deleteSegment(doc: EditorDocument, segId: string): EditorDocument {
  return { ...doc, subtitles: { ...doc.subtitles, source: "edited", segments: doc.subtitles.segments.filter((s) => s.id !== segId) } };
}

export function mergeSegmentWithNext(doc: EditorDocument, segId: string): EditorDocument {
  const segs = [...doc.subtitles.segments].sort((a, b) => (a.words[0]?.start ?? 0) - (b.words[0]?.start ?? 0));
  const i = segs.findIndex((s) => s.id === segId);
  if (i < 0 || i === segs.length - 1 || segs[i].assetId !== segs[i + 1].assetId) return doc;
  const merged = { ...segs[i], words: [...segs[i].words, ...segs[i + 1].words] };
  const next = segs.filter((_, j) => j !== i + 1).map((s) => (s.id === segId ? merged : s));
  return { ...doc, subtitles: { ...doc.subtitles, source: "edited", segments: next } };
}

export function splitSegmentAtWord(doc: EditorDocument, segId: string, wordIndex: number): EditorDocument {
  const seg = doc.subtitles.segments.find((s) => s.id === segId);
  if (!seg || wordIndex <= 0 || wordIndex >= seg.words.length) return doc;
  const a = { ...seg, words: seg.words.slice(0, wordIndex) };
  const b = { ...seg, id: uid("seg"), words: seg.words.slice(wordIndex) };
  return {
    ...doc,
    subtitles: { ...doc.subtitles, source: "edited", segments: doc.subtitles.segments.flatMap((s) => (s.id === segId ? [a, b] : [s])) },
  };
}

/** Shift a segment's timing (in seconds of source time; equals timeline seconds within a clip). */
export function shiftSegment(doc: EditorDocument, segId: string, delta: number): EditorDocument {
  return {
    ...doc,
    subtitles: {
      ...doc.subtitles,
      source: "edited",
      segments: doc.subtitles.segments.map((s) =>
        s.id !== segId ? s : { ...s, words: s.words.map((w) => ({ ...w, start: Math.max(0, w.start + delta), end: Math.max(0, w.end + delta) })) },
      ),
    },
  };
}

/** Stretch a segment so that its first word starts at `start` and last ends at `end` (source time). */
export function retimeSegment(doc: EditorDocument, segId: string, start: number, end: number): EditorDocument {
  const seg = doc.subtitles.segments.find((s) => s.id === segId);
  if (!seg || !seg.words.length || end - start < 0.1) return doc;
  const s0 = seg.words[0].start;
  const s1 = seg.words[seg.words.length - 1].end;
  const k = s1 - s0 > EPS ? (end - start) / (s1 - s0) : 1;
  const words = seg.words.map((w) => ({ ...w, start: start + (w.start - s0) * k, end: start + (w.end - s0) * k }));
  return { ...doc, subtitles: { ...doc.subtitles, source: "edited", segments: doc.subtitles.segments.map((s) => (s.id === segId ? { ...s, words } : s)) } };
}

export function formatTimecode(t: number, fps = 30): string {
  const neg = t < 0;
  t = Math.max(0, Math.abs(t));
  const totalFrames = Math.round(t * fps);
  const f = totalFrames % fps;
  const s = Math.floor(totalFrames / fps) % 60;
  const m = Math.floor(totalFrames / fps / 60);
  return `${neg ? "-" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

export function formatShort(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0").replace(".", ",")}`;
}
