/**
 * Auto Reels: one long recording (a podcast, a webinar) → N ready reels. The AI rates the sentences of
 * the transcript as hooks and says which passage gives each hook its context; these pure helpers turn
 * its answer into clean, non-overlapping cuts of the wanted length. Shared by the server and tests.
 */

export interface ArSegment {
  /** global number (as the AI sees it) */
  id: number;
  /** which recording of the project */
  src: number;
  start: number;
  end: number;
  text: string;
}

/** What the AI answers per reel: sentence numbers of the hook and of the passage after it. */
export interface ArRawPick {
  hook_from?: unknown;
  hook_to?: unknown;
  from?: unknown;
  to?: unknown;
  title?: unknown;
  score?: unknown;
  reason?: unknown;
}

export interface ArClip {
  src: number;
  hook: [number, number];
  body: [number, number];
  hookText: string;
  bodyText: string;
  title: string;
  score: number;
  reason: string;
  /** seconds: hook + body */
  duration: number;
}

export interface ArOptions {
  count: number;
  min: number;
  max: number;
}

/** A hook longer than this is cut down to its first sentence(s). */
export const HOOK_MAX = 12;

const span = (segs: ArSegment[]) => (segs.length ? segs[segs.length - 1].end - segs[0].start : 0);
const overlap = (a: [number, number], b: [number, number]) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));

/**
 * The AI's picks → reels: ids resolved to sentences of one recording, the hook kept short, the passage
 * stretched or trimmed (by whole sentences) to min…max seconds with the hook, picks repeating a
 * passage already taken dropped; best first, at most `count`.
 */
export function resolvePicks(segs: ArSegment[], raw: ArRawPick[], opts: ArOptions): ArClip[] {
  const byId = new Map(segs.map((s) => [s.id, s]));
  const idx = new Map(segs.map((s, i) => [s.id, i]));
  const out: ArClip[] = [];
  for (const r of raw) {
    const h0 = byId.get(Number(r.hook_from));
    const h1 = byId.get(Number(r.hook_to ?? r.hook_from)) ?? h0;
    const b0 = byId.get(Number(r.from));
    const b1 = byId.get(Number(r.to ?? r.from)) ?? b0;
    if (!h0 || !h1 || !b0 || !b1 || h1.id < h0.id || b1.id < b0.id) continue;
    // all of one reel from one recording
    if (h0.src !== h1.src || b0.src !== b1.src || h0.src !== b0.src) continue;
    let hook = segs.slice(idx.get(h0.id)!, idx.get(h1.id)! + 1);
    while (hook.length > 1 && span(hook) > HOOK_MAX) hook = hook.slice(0, -1);
    let bi0 = idx.get(b0.id)!;
    let bi1 = idx.get(b1.id)!;
    // the hook opens the passage: the passage goes on after it (said once, not twice)
    const hi0 = idx.get(hook[0].id)!;
    const hi1 = idx.get(hook[hook.length - 1].id)!;
    if (hi0 <= bi0 && hi1 >= bi0) bi0 = hi1 + 1;
    if (bi0 > bi1) bi1 = bi0;
    const same = (i: number) => i >= 0 && i < segs.length && segs[i].src === h0.src;
    if (!same(bi0)) continue;
    const hookLen = span(hook);
    const len = () => hookLen + (segs[bi1].end - segs[bi0].start);
    // too short: the next sentences (then the ones before, never back into the hook)
    while (len() < opts.min && same(bi1 + 1) && segs[bi1 + 1].end - segs[bi0].start + hookLen <= opts.max) bi1++;
    while (len() < opts.min && same(bi0 - 1) && bi0 - 1 > hi1 && segs[bi1].end - segs[bi0 - 1].start + hookLen <= opts.max) bi0--;
    // too long: whole sentences off the end
    while (len() > opts.max && bi1 > bi0) bi1--;
    if (len() > opts.max + 5 || len() < Math.min(opts.min, 12)) continue;
    const body = segs.slice(bi0, bi1 + 1);
    const score = Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)));
    out.push({
      src: h0.src,
      hook: [hook[0].start, hook[hook.length - 1].end],
      body: [body[0].start, body[body.length - 1].end],
      hookText: hook.map((s) => s.text).join(" "),
      bodyText: body.map((s) => s.text).join(" "),
      title: String(r.title ?? "").trim().slice(0, 120) || hook[0].text.slice(0, 80),
      score,
      reason: String(r.reason ?? "").trim().slice(0, 300),
      duration: Math.round(len() * 10) / 10,
    });
  }
  // best first; a reel whose passage or hook is mostly one already taken is dropped
  out.sort((a, b) => b.score - a.score);
  const taken: ArClip[] = [];
  for (const c of out) {
    const clash = taken.some(
      (t) =>
        t.src === c.src &&
        (overlap(t.body, c.body) > 0.4 * Math.min(t.body[1] - t.body[0], c.body[1] - c.body[0]) || overlap(t.hook, c.hook) > 0.5 * Math.min(t.hook[1] - t.hook[0], c.hook[1] - c.hook[0])),
    );
    if (!clash) taken.push(c);
    if (taken.length >= opts.count) break;
  }
  return taken;
}

/** How many AI graphics a reel gets: one for a short one, more as it gets longer (at most 3). */
export function visualsForLength(seconds: number): number {
  return Math.max(1, Math.min(3, Math.round(seconds / 35)));
}

/** Candidates to ask for in a window of the recording (more than needed: the weaker ones are dropped). */
export function candidatesFor(windowSec: number, totalSec: number, count: number): number {
  return Math.max(3, Math.min(40, Math.ceil(((count * windowSec) / Math.max(1, totalSec)) * 1.6)));
}
