import type { AVClip, EditorDocument, HookVariant, SubWord } from "./types";

/** A part of an ad take, in seconds of the recording: hook i, or the body (marked by the expert's taps). */
export interface AdPart {
  kind: "hook" | "body";
  i: number;
  start: number;
  end: number;
}

const letter = (i: number) => `Hook ${String.fromCharCode(65 + i)}`;

/**
 * Hook + prompter ad recorded in one take (hook 1, hook 2… then the body): one edit — the hook clip
 * switches between the hooks (like an Ads Studio reel), the body is edited once for all of them.
 */
export function splitAdTake(doc: EditorDocument, parts: AdPart[], title: string): EditorDocument {
  const hooks = parts.filter((p) => p.kind === "hook" && p.end - p.start > 0.3).sort((a, b) => a.i - b.i);
  const body = parts.find((p) => p.kind === "body" && p.end - p.start > 0.3);
  const base = doc.clips[0];
  if (!base || !hooks.length || !body) return doc;
  const round = (x: number) => Math.round(x * 1000) / 1000;
  const hook: AVClip = { ...base, id: `${base.id}_hook`, label: "HOOK", sourceIn: round(hooks[0].start), sourceOut: round(hooks[0].end), start: base.start };
  const len = hook.sourceOut - hook.sourceIn;
  const bodyClip: AVClip = { ...base, id: `${base.id}_body`, label: "BODY", sourceIn: round(body.start), sourceOut: round(body.end), start: Math.round((base.start + len) * 30) / 30 };
  const { id: _id, start: _start, ...rest } = hook;
  void _id;
  void _start;
  const variants: HookVariant[] = hooks.map((h, k) => ({ id: `hook_${k}`, code: letter(k), title, clip: { ...rest, sourceIn: round(h.start), sourceOut: round(h.end) } }));
  return { ...doc, clips: [hook, bodyClip], hooks: hooks.length > 1 ? { clipId: hook.id, active: 0, variants } : undefined, meta: { ...doc.meta, adSplit: "markers" } };
}

/**
 * Once the transcript is there: each hook and the body start right before their first word and end
 * right after their last one (the taps came a moment late / early). The edit is laid out again.
 */
export function tightenAdTake(doc: EditorDocument, words: Array<Pick<SubWord, "start" | "end">>): EditorDocument {
  if (doc.meta.adSplit !== "markers" || !words.length) return doc;
  const fit = (c: { sourceIn: number; sourceOut: number }) => {
    const inside = words.filter((w) => w.start >= c.sourceIn - 0.05 && w.end <= c.sourceOut + 0.3);
    if (!inside.length) return c;
    return { ...c, sourceIn: Math.max(c.sourceIn, inside[0].start - 0.15), sourceOut: Math.min(c.sourceOut + 0.3, inside[inside.length - 1].end + 0.3) };
  };
  const hookClip = doc.clips.find((c) => c.label === "HOOK");
  const bodyClip = doc.clips.find((c) => c.label === "BODY");
  if (!hookClip || !bodyClip) return doc;
  const h = fit(hookClip);
  const b = fit(bodyClip);
  const clips = [
    { ...hookClip, ...h },
    { ...bodyClip, ...b, start: Math.round((hookClip.start + h.sourceOut - h.sourceIn) * 30) / 30 },
  ];
  const hooks = doc.hooks ? { ...doc.hooks, variants: doc.hooks.variants.map((v) => (v.clip ? { ...v, clip: { ...v.clip, ...fit(v.clip) } } : v)) } : undefined;
  return { ...doc, clips, ...(hooks ? { hooks } : {}), meta: { ...doc.meta, adSplit: "words" } };
}
