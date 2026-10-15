/**
 * "Dynamiczne zbliżenia" — zoom effect evaluation and deterministic suggestions.
 */
import type { EditorDocument, Easing, ZoomEffect, ZoomType } from "./types";
import { cutPoints, docDuration, timedSegments } from "./timeline";
import { uid } from "./id";

export function ease(e: Easing, p: number): number {
  p = Math.min(1, Math.max(0, p));
  switch (e) {
    case "linear":
      return p;
    case "easeIn":
      return p * p * p;
    case "easeOut":
      return 1 - Math.pow(1 - p, 3);
    case "easeInOut":
      return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    case "step":
      return 1;
  }
}

/** Zoom scale + centre at timeline time t. Outside any region the frame is at 100%. */
export function zoomAt(zooms: ZoomEffect[], t: number, includeSuggested = false): { scale: number; cx: number; cy: number } {
  let active: ZoomEffect | null = null;
  for (const z of zooms) {
    if (z.suggested && !includeSuggested) continue; // unaccepted suggestions are never exported
    if (t >= z.start && t < z.end && (!active || z.start >= active.start)) active = z;
  }
  if (!active) return { scale: 1, cx: 0.5, cy: 0.45 };
  const p = (t - active.start) / Math.max(1e-3, active.end - active.start);
  const k = ease(active.easing, p);
  return { scale: Math.max(1, active.fromScale + (active.toScale - active.fromScale) * k), cx: active.cx, cy: active.cy };
}

export const ZOOM_PRESETS: Record<ZoomType, { label: string; from: number; to: number; easing: Easing; duration: number }> = {
  "smooth-in": { label: "Płynne przybliżenie", from: 1, to: 1.15, easing: "easeInOut", duration: 2.5 },
  "smooth-out": { label: "Płynne oddalenie", from: 1.15, to: 1, easing: "easeInOut", duration: 2.5 },
  "jump-in": { label: "Skokowe przybliżenie", from: 1.18, to: 1.18, easing: "step", duration: 4 },
  "jump-out": { label: "Skokowe oddalenie", from: 1, to: 1, easing: "step", duration: 3 },
  "push-in": { label: "Subtelny najazd", from: 1, to: 1.08, easing: "linear", duration: 6 },
};

export function makeZoom(type: ZoomType, start: number, opts: Partial<ZoomEffect> = {}): ZoomEffect {
  const p = ZOOM_PRESETS[type];
  return {
    id: uid("zoom"),
    type,
    start,
    end: start + p.duration,
    fromScale: p.from,
    toScale: p.to,
    easing: p.easing,
    cx: 0.5,
    cy: 0.42,
    ...opts,
  };
}

export type ZoomIntensity = "minimal" | "standard" | "dynamic";

const INTENSITY: Record<ZoomIntensity, { minGap: number; jumpScale: number; smoothTo: number; pushTo: number; hold: [number, number] }> = {
  minimal: { minGap: 9, jumpScale: 1.1, smoothTo: 1.08, pushTo: 1.05, hold: [4, 6] },
  standard: { minGap: 6, jumpScale: 1.15, smoothTo: 1.12, pushTo: 1.07, hold: [4, 7] },
  dynamic: { minGap: 3.5, jumpScale: 1.22, smoothTo: 1.16, pushTo: 1.1, hold: [3, 5] },
};

/**
 * Deterministic rules: anchor effects on sentence boundaries (from word timestamps)
 * and on existing cuts (a jump zoom hides a jump cut), keep a minimum gap between
 * effects, vary types so the result is not constant aggressive zooming.
 */
export function suggestZooms(doc: EditorDocument, intensity: ZoomIntensity = "standard", faceCenter?: { cx: number; cy: number }): ZoomEffect[] {
  const cfg = INTENSITY[intensity];
  const duration = docDuration(doc);
  if (duration < 4) return [];
  const anchors = new Set<number>();
  for (const c of cutPoints(doc)) anchors.add(Math.round(c * 30) / 30);
  const segs = timedSegments(doc);
  for (const s of segs) {
    const last = s.words[s.words.length - 1];
    if (/[.!?…]$/.test(last.text)) {
      const next = segs.find((x) => x.t0 >= last.t1 - 0.01);
      if (next) anchors.add(Math.round(next.t0 * 30) / 30);
    }
  }
  if (anchors.size < 2) {
    // no transcript: fall back to a regular rhythm on speech
    for (let t = cfg.minGap; t < duration - 3; t += cfg.minGap + 2) anchors.add(t);
  }
  const startAfter = doc.meta.mode === "CONTINUOUS" && doc.meta.narrationEnd ? Math.min(duration, 1.5) : 1.5;
  const sorted = [...anchors].filter((t) => t >= startAfter && t < duration - 2).sort((a, b) => a - b);
  const cuts = new Set(cutPoints(doc).map((c) => Math.round(c * 30) / 30));
  const out: ZoomEffect[] = [];
  let lastEnd = 0;
  let n = 0;
  const pattern: ZoomType[] = ["jump-in", "push-in", "jump-in", "smooth-in"];
  const cx = faceCenter?.cx ?? 0.5;
  const cy = faceCenter?.cy ?? 0.42;
  for (const t of sorted) {
    if (t - lastEnd < cfg.minGap) continue;
    const hold = cfg.hold[0] + ((n * 7) % 3) * ((cfg.hold[1] - cfg.hold[0]) / 2);
    const end = Math.min(duration, t + hold);
    if (end - t < 1.5) continue;
    let type = pattern[n % pattern.length];
    if (cuts.has(t)) type = "jump-in";
    const z: ZoomEffect =
      type === "jump-in"
        ? makeZoom("jump-in", t, { end, fromScale: cfg.jumpScale, toScale: cfg.jumpScale, cx, cy, suggested: true })
        : type === "push-in"
          ? makeZoom("push-in", t, { end, fromScale: 1, toScale: cfg.pushTo, cx, cy, suggested: true })
          : makeZoom("smooth-in", t, { end, fromScale: 1, toScale: cfg.smoothTo, cx, cy, suggested: true });
    out.push(z);
    lastEnd = end;
    n++;
  }
  return out;
}
