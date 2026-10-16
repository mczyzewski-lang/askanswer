import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { openaiConfigured } from "./env";
import { generateInfographic, suggestBroll, type BrollSuggestion } from "./broll";
import { docDuration, timedSegments } from "../editor/timeline";
import { infographicOverlay } from "../editor/ai-overlays";
import { uid } from "../editor/id";
import { videoModel } from "./higgsfield";
import type { AiBrollItem, EditorDocument } from "../editor/types";

/**
 * Right after a recording is processed: let the AI pick the moments, generate the infographics
 * (OpenAI when configured, else the theme template) and place them in the video — no acceptance
 * needed. Video scenes (Higgsfield, paid per clip) stay as proposals in the Studio AI tab.
 * Runs once per composition (doc.meta.autoVisuals).
 */
const MAX_AUTO = 3;

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
  // infographics: the AI's picks first; with none, the strongest proposal becomes one
  let infos = suggestions.filter((s) => s.kind === "infographic" && s.infographic.items.length);
  if (!infos.length && suggestions[0]?.infographic.items.length) infos = [{ ...suggestions[0], kind: "infographic" }];
  infos = infos.slice(0, MAX_AUTO);
  const engine = openaiConfigured() ? "openai" : "template";

  // in parallel (each OpenAI image takes up to a minute)
  const placed: Array<{ s: BrollSuggestion; assetId: string; warning: string | null }> = await Promise.all(
    infos.map(async (s) => {
      try {
        const r = await generateInfographic(jobId, { compositionId, infographic: s.infographic, engine, illustration: "none", width: doc0.width, height: doc0.height });
        return { s, assetId: r.assetId, warning: r.warning };
      } catch (e) {
        // OpenAI failed for this one (moderation, quota…): fall back to the crisp template
        if (engine !== "openai") throw e;
        const r = await generateInfographic(jobId, { compositionId, infographic: s.infographic, engine: "template", illustration: "none", width: doc0.width, height: doc0.height });
        return { s, assetId: r.assetId, warning: `OpenAI: ${(e as Error).message} — użyto szablonu.` };
      }
    }),
  );
  const model = videoModel(null).id;
  const proposals = suggestions.filter((s) => !infos.some((i) => i.id === s.id));

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
      items.push(toItem(p.s, model, { kind: "infographic", status: "done", overlayId: ov.id, engine, warning: p.warning }));
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
    const warnings = [suggestWarning, ...placed.map((p) => p.warning)].filter((w): w is string => !!w);
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
    duration: s.duration,
    model,
    status: "suggested",
    ...extra,
  };
}
