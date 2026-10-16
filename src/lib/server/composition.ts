import { prisma } from "./db";
import { assetInfo } from "./assets";
import { themeFromRow } from "../themes";
import { syncTheme } from "../question-styles";
import { referencedAssetIds } from "./render-job";
import type { EditorDocument } from "../editor/types";
import { signedUrl } from "./storage";
import { elevenLabsConfigured, env, higgsfieldConfigured, openaiConfigured, openaiKeyDiagnostics } from "./env";
import { VIDEO_MODELS, videoModel } from "./higgsfield";

/** Everything the Studio needs to open a composition. */
export async function loadStudio(id: string) {
  const comp = await prisma.videoComposition.findUniqueOrThrow({
    where: { id },
    include: { project: { include: { theme: true } }, question: true, take: { include: { transcript: { select: { id: true, model: true, languageCode: true } } } } },
  });
  const doc = comp.document as unknown as EditorDocument;
  // the project theme is the source of truth: theme edits propagate to every video
  if (comp.project.theme) syncTheme(doc, themeFromRow(comp.project.theme));
  const ids = new Set(referencedAssetIds(doc));
  // illustration variants to choose from in the AI tab
  for (const it of doc.meta.aiBroll ?? []) for (const v of it.variants ?? []) ids.add(v);
  if (doc.theme.logoAssetId) ids.add(doc.theme.logoAssetId);
  const assets = (await Promise.all([...ids].map((a) => assetInfo(a, true)))).filter(Boolean);
  // other takes of the same question (for "Zamień ujęcie")
  const takes = comp.question
    ? await prisma.recordingTake.findMany({
        where: { recording: { questionId: comp.question.id }, status: "READY" },
        orderBy: { takeNumber: "asc" },
        select: { id: true, takeNumber: true, durationSec: true, createdAt: true },
      })
    : [];
  const renders = await prisma.renderJob.findMany({ where: { compositionId: id }, orderBy: { createdAt: "desc" }, take: 5 });
  const renderInfos = await Promise.all(
    renders.map(async (r) => {
      const out = r.outputAssetId ? await prisma.mediaAsset.findUnique({ where: { id: r.outputAssetId } }) : null;
      return {
        id: r.id,
        status: r.status,
        progress: r.progress,
        error: r.error,
        settings: r.settings,
        createdAt: r.createdAt,
        downloadUrl: out ? await signedUrl(out.storageKey, { download: out.originalName ?? "wideo.mp4" }) : null,
      };
    }),
  );
  const take = comp.take;
  return {
    composition: { id: comp.id, name: comp.name, version: comp.version, status: comp.status, updatedAt: comp.updatedAt, document: doc },
    project: { id: comp.project.id, name: comp.project.name, themeId: comp.project.themeId, voiceId: comp.project.voiceId ?? env.defaultVoiceId },
    question: comp.question ? { id: comp.question.id, text: comp.question.text } : null,
    take: take
      ? {
          id: take.id,
          takeNumber: take.takeNumber,
          hasTranscript: !!take.transcript,
          transcriptionError: take.transcriptionError,
          originalAssetId: take.originalAssetId,
          markers: take.markers,
        }
      : null,
    takes,
    assets,
    renders: renderInfos,
    elevenLabs: elevenLabsConfigured(),
    ...(await autoVisualsState(id)),
    ai: {
      higgsfield: higgsfieldConfigured(),
      claude: env.anthropicConfigured,
      openai: openaiConfigured(),
      // why OpenAI is off, as the server sees it (variable names and key length only)
      openaiHint: openaiConfigured() ? null : openaiKeyDiagnostics(),
      models: VIDEO_MODELS.map((m) => ({ id: m.id, label: m.label, description: m.description, durations: m.durations })),
      defaultModel: videoModel(null).id,
    },
  };
}

/** The automatic infographics job of a composition: pending flag + last outcome (shown in the Studio AI tab). */
export async function autoVisualsState(compositionId: string) {
  const job = await prisma.job.findUnique({ where: { idempotencyKey: `auto-visuals:${compositionId}` }, select: { id: true, status: true, error: true, result: true, updatedAt: true } });
  return {
    autoVisualsPending: !!job && (job.status === "QUEUED" || job.status === "RUNNING"),
    autoVisualsJob: job ? { id: job.id, status: job.status, error: job.error, result: job.result as Record<string, unknown> | null, updatedAt: job.updatedAt.toISOString() } : null,
  };
}
