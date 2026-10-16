import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { higgsfieldConfigured, openaiConfigured } from "./env";
import { generateInfographic, suggestBroll, type BrollSuggestion } from "./broll";
import { docDuration, timedSegments } from "../editor/timeline";
import { infographicOverlay } from "../editor/ai-overlays";
import { uid } from "../editor/id";
import { videoModel } from "./higgsfield";
import type { AiBrollItem, EditorDocument } from "../editor/types";

/**
 * Right after a recording is processed: the AI finds the main thoughts of the answer (whole
 * passages, not single sentences), draws a full-screen illustration of each (OpenAI, theme colours,
 * category style, no text) — or an infographic where figures are given — and places them under the
 * captions, no acceptance needed. Video scenes (Higgsfield, paid per clip) stay as proposals.
 * Runs once per composition (doc.meta.autoVisuals).
 */
const MAX_AUTO = 4;

export interface AutoVisualsResult {
  placed: number;
  proposed: number;
  skipped?: string;
  engine?: string;
  warnings?: string[];
}

/** `force`: run again on demand ("Osadź infografiki" in the Studio) even if it already ran. */
export async function autoVisuals(jobId: string, compositionId: string, force = false): Promise<AutoVisualsResult> {
  const comp = await prisma.videoComposition.findUnique({ where: { id: compositionId }, include: { project: true } });
  if (!comp) return { placed: 0, proposed: 0, skipped: "no composition" };
  if (!comp.project.autoInfographics && !force) return { placed: 0, proposed: 0, skipped: "disabled" };
  const doc0 = comp.document as unknown as EditorDocument;
  const before = doc0.meta.autoVisuals;
  if (before && !force) return { placed: 0, proposed: 0, skipped: "already done" };
  const segments = timedSegments(doc0).map((s) => ({ t0: s.t0, t1: s.t1, text: s.words.map((w) => w.text).join(" ") }));
  if (!segments.length) return { placed: 0, proposed: 0, skipped: "no transcript" };
  const duration = docDuration(doc0);

  const { suggestions, warning: suggestWarning } = await suggestBroll(compositionId, segments, duration, { fallback: true });
  const canIllustrate = openaiConfigured() || higgsfieldConfigured();
  // illustrations of the main thoughts (+ infographics where the expert gives figures); with no
  // image provider only infographics can be made, rendered from the theme template
  let picks = suggestions.filter((s) => (s.kind === "illustration" && canIllustrate) || (s.kind === "infographic" && s.infographic.items.length));
  if (!picks.length && suggestions.length) picks = canIllustrate ? suggestions.slice(0, MAX_AUTO).map((s) => ({ ...s, kind: "illustration" as const })) : suggestions.filter((s) => s.infographic.items.length).slice(0, 1).map((s) => ({ ...s, kind: "infographic" as const }));
  picks = picks.slice(0, MAX_AUTO);
  const infoEngine = openaiConfigured() ? "openai" : "template";

  // in parallel (each OpenAI image takes up to a minute)
  const settled = await Promise.all(
    picks.map(async (s): Promise<{ s: BrollSuggestion; assetId: string; variantIds?: string[]; warning: string | null; engine: "openai" | "template" } | { s: BrollSuggestion; failed: string }> => {
      const base = { compositionId, width: doc0.width, height: doc0.height };
      try {
        if (s.kind === "illustration") {
          // each moment: its own key sentence, and what the other moments show — so the pictures differ
          const others = picks.filter((o) => o.id !== s.id && o.kind === "illustration").map((o) => o.quote.slice(0, 160));
          const r = await generateInfographic(jobId, { ...base, engine: "illustration", infographic: { headline: s.title, items: [], note: null }, imagePrompt: s.imagePrompt, passage: s.passage, focus: s.quote, others, title: s.title });
          return { s, assetId: r.assetId, variantIds: "variantIds" in r ? r.variantIds : undefined, warning: r.warning, engine: openaiConfigured() ? "openai" : "template" };
        }
        const r = await generateInfographic(jobId, { ...base, infographic: s.infographic, engine: infoEngine, illustration: "none" });
        return { s, assetId: r.assetId, warning: r.warning, engine: infoEngine };
      } catch (e) {
        // an illustration that failed (moderation, quota…) stays as a proposal with the reason
        if (s.kind === "illustration") return { s, failed: (e as Error).message };
        if (infoEngine !== "openai") throw e;
        const r = await generateInfographic(jobId, { ...base, infographic: s.infographic, engine: "template", illustration: "none" });
        return { s, assetId: r.assetId, warning: `OpenAI: ${(e as Error).message} — użyto szablonu.`, engine: "template" };
      }
    }),
  );
  const placed = settled.filter((x): x is Extract<typeof x, { assetId: string }> => "assetId" in x);
  const failed = settled.filter((x): x is Extract<typeof x, { failed: string }> => "failed" in x);
  if (picks.length && !placed.length && failed.length) throw new Error(`Ilustracje nie powstały: ${failed[0].failed}`);
  const model = videoModel(null).id;
  const proposals = suggestions.filter((s) => !placed.some((i) => i.s.id === s.id));

  // write into the latest document (the editor may have saved meanwhile): optimistic, retried
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await prisma.videoComposition.findUniqueOrThrow({ where: { id: compositionId } });
    const doc = cur.document as unknown as EditorDocument;
    if (doc.meta.autoVisuals !== before) return { placed: 0, proposed: 0, skipped: "already done" };
    const total = docDuration(doc);
    const items: AiBrollItem[] = [];
    const overlays = [];
    for (const p of placed) {
      const ov = infographicOverlay(p.s, p.assetId, total);
      overlays.push(ov);
      items.push(toItem(p.s, model, { status: "done", overlayId: ov.id, engine: p.engine, variants: p.variantIds, illustration: p.s.kind === "illustration", illustrationSource: openaiConfigured() ? "openai" : "higgsfield", warning: p.warning }));
    }
    // on a re-run only new infographics; the earlier video proposals stay as they are
    for (const s of force && before ? [] : proposals) items.push(toItem(s, model, { status: "suggested", illustration: true, illustrationSource: openaiConfigured() ? "openai" : "higgsfield" }));
    const next: EditorDocument = {
      ...doc,
      // under the question and the other layers; captions are always drawn on top
      overlays: [...overlays, ...doc.overlays],
      // a new stamp per run: an open Studio sees that something new arrived and merges it
      meta: { ...doc.meta, aiBroll: [...(doc.meta.aiBroll ?? []), ...items], autoVisuals: before ? `r${Date.now().toString(36)}` : "done" } as EditorDocument["meta"],
    };
    const r = await prisma.videoComposition.updateMany({ where: { id: compositionId, version: cur.version }, data: { document: next as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
    const warnings = [suggestWarning, ...placed.map((p) => p.warning), ...failed.map((f) => `Ilustracja „${f.s.title}” nie powstała: ${f.failed}`)].filter((w): w is string => !!w);
    const engine = placed.some((p) => p.s.kind === "illustration") ? "illustration" : infoEngine;
    if (r.count === 1) return { placed: placed.length, proposed: force && before ? 0 : proposals.length, engine, warnings: [...new Set(warnings)] };
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error("Nie udało się zapisać infografik — kompozycja była w tym czasie edytowana. Spróbuj ponownie.");
}

function toItem(s: BrollSuggestion, model: string, extra: Partial<AiBrollItem>): AiBrollItem {
  return {
    id: uid("ai"),
    kind: s.kind,
    start: s.start,
    end: s.end,
    quote: s.quote,
    title: s.title,
    reason: s.reason,
    prompt: s.prompt,
    imagePrompt: s.imagePrompt,
    infographic: s.infographic,
    passage: s.passage || undefined,
    duration: s.duration,
    model,
    status: "suggested",
    ...extra,
  };
}
