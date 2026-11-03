import type { EditorDocument, VideoOverlay } from "./types";
import { docDuration } from "./timeline";

/** A cutaway from the campaign's B-roll basket (a piece of an uploaded B-roll video). */
export interface BasketFragment {
  id: string;
  assetId: string;
  sourceIn: number;
  sourceOut: number;
  name?: string;
}

/** small seeded random generator: the same reel gets the same cutaways when laid out again */
function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** longest a cutaway stays on screen (the expert is seen again soon) */
export const BROLL_MAX_SHOT = 3.5;
/** gap kept around the hook and before the CTA */
const MARGIN = 0.6;

/**
 * Put `count` cutaways from the basket into the reel: picked at random (seeded by the reel), spread
 * evenly over the body — never over the hook (the first seconds sell the reel) nor the CTA — full
 * screen and muted, so the expert keeps talking underneath. Replaces cutaways placed earlier this way.
 */
export function placeBasketBroll(doc: EditorDocument, basket: BasketFragment[], count: number, seed: string): EditorDocument {
  const kept = doc.overlays.filter((o) => !(o.kind === "video" && o.id.startsWith("basket_")));
  const base = { ...doc, overlays: kept };
  if (!basket.length || count <= 0) return base;
  const total = docDuration(base);
  const hook = base.clips.find((c) => c.label === "HOOK");
  const cta = base.clips.find((c) => c.label === "CTA");
  const from = (hook ? hook.start + (hook.sourceOut - hook.sourceIn) : 0) + MARGIN;
  const to = (cta ? cta.start : total) - MARGIN;
  const span = to - from;
  const n = Math.min(count, basket.length, Math.floor(span / (BROLL_MAX_SHOT + 1)));
  if (n <= 0) return base;
  const rand = rng(seed);
  const pool = [...basket];
  const picked: BasketFragment[] = [];
  for (let i = 0; i < n; i++) picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  const slot = span / n;
  const overlays: VideoOverlay[] = picked.map((f, i) => {
    const len = Math.min(f.sourceOut - f.sourceIn, BROLL_MAX_SHOT, slot - 0.5);
    const start = Math.round((from + i * slot + (slot - len) / 2) * 30) / 30;
    return {
      id: `basket_${i}_${f.id.slice(-6)}`,
      kind: "video",
      name: `B-roll ${i + 1}${f.name ? `: ${f.name}` : ""}`.slice(0, 80),
      assetId: f.assetId,
      fit: "cover",
      sourceIn: f.sourceIn,
      loop: false,
      volume: 0,
      radius: 0,
      start,
      end: Math.round((start + len) * 30) / 30,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      opacity: 1,
      animation: "fade",
    };
  });
  // under the title, captions and graphics: first in the list = drawn first
  return { ...base, overlays: [...overlays, ...kept] };
}
