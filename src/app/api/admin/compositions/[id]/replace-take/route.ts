import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { buildInitialDocument } from "@/lib/editor/factory";
import { buildSegments } from "@/lib/editor/subtitles";
import { themeFromRow, DEFAULT_THEME } from "@/lib/themes";
import { assetInfo } from "@/lib/server/assets";
import type { EditorDocument } from "@/lib/editor/types";

/**
 * Build a document for another take of the same question, keeping the current
 * design (overlays, subtitle style, music, theme). Returned to the editor, which
 * applies it as an undoable change.
 */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const { takeId, document } = z.object({ takeId: z.string(), document: z.any() }).parse(await req.json());
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id }, include: { project: { include: { theme: true } } } });
  const take = await prisma.recordingTake.findUniqueOrThrow({
    where: { id: takeId },
    include: { recording: { include: { question: true } }, transcript: { include: { words: { orderBy: { index: "asc" } } } }, silences: true },
  });
  if (take.recording.questionId !== comp.questionId) return json({ error: "To ujęcie należy do innego pytania" }, 400);
  if (!take.normalizedAssetId) return json({ error: "Ujęcie jest jeszcze przetwarzane" }, 409);
  const normalized = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: take.normalizedAssetId } });
  const narration = take.narrationAssetId ? await prisma.mediaAsset.findUnique({ where: { id: take.narrationAssetId } }) : null;
  const markers = (take.markers ?? {}) as { narrationStart?: number; narrationEnd?: number };
  const cur = document as EditorDocument;
  const fresh = buildInitialDocument({
    questionText: take.recording.question.text,
    theme: comp.project.theme ? themeFromRow(comp.project.theme) : DEFAULT_THEME,
    mode: take.mode,
    recording: { assetId: normalized.id, duration: normalized.durationSec ?? 0 },
    narration: narration ? { assetId: narration.id, duration: narration.durationSec ?? 0 } : null,
    narrationWindow: take.mode === "CONTINUOUS" && markers.narrationEnd != null ? { start: markers.narrationStart ?? 0, end: markers.narrationEnd } : null,
    segments: buildSegments(normalized.id, (take.transcript?.words ?? []).filter((w) => w.type === "word")),
    pauses: take.silences.map((s) => ({ start: s.start, end: s.end, confidence: s.confidence })),
    visibility: comp.project.questionVisibility,
    questionSeconds: comp.project.questionSeconds,
  });
  const next: EditorDocument = {
    ...fresh,
    width: cur.width,
    height: cur.height,
    overlays: cur.overlays ?? fresh.overlays,
    music: cur.music ?? [],
    subtitles: { ...fresh.subtitles, enabled: cur.subtitles?.enabled ?? true, preset: cur.subtitles?.preset ?? fresh.subtitles.preset, style: cur.subtitles?.style ?? fresh.subtitles.style },
    meta: { ...fresh.meta, pauseSensitivity: cur.meta?.pauseSensitivity ?? "standard", pausePadding: cur.meta?.pausePadding ?? 0.2 },
  };
  await prisma.videoComposition.update({ where: { id }, data: { takeId } });
  const assets = await Promise.all([normalized.id, narration?.id].filter(Boolean).map((a) => assetInfo(a as string, true)));
  return json({ document: next, assets: assets.filter(Boolean) });
});
