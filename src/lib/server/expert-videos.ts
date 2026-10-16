import { prisma } from "./db";
import { enqueue } from "./jobs";
import { signedUrl } from "./storage";

/**
 * The film an expert watches for a question in editing / approved: always the CURRENT edit.
 * An export made from the composition as it is now is used directly; when the edit changed
 * since (or was never exported) a light preview render (720p draft) is queued and, until it is
 * ready, the newest older export — or the recording — is shown with a "rendering" note.
 */
export const WATCHABLE = ["IN_PROGRESS", "APPROVED"];

export async function expertVideo(projectId: string, expertId: string, questionId: string) {
  const q = await prisma.question.findFirst({
    where: { id: questionId, projectId, expertId, status: { in: WATCHABLE as never } },
    include: { recording: { include: { takes: { where: { status: "READY" }, orderBy: { takeNumber: "desc" }, select: { id: true, normalizedAssetId: true } } } } },
  });
  if (!q) return null;
  const selected = q.recording?.selectedTakeId;
  const comp =
    (selected ? await prisma.videoComposition.findFirst({ where: { questionId, takeId: selected }, orderBy: { updatedAt: "desc" } }) : null) ??
    (await prisma.videoComposition.findFirst({ where: { questionId }, orderBy: { updatedAt: "desc" } }));

  const assetUrl = async (id: string | null | undefined) => {
    const a = id ? await prisma.mediaAsset.findUnique({ where: { id } }) : null;
    return a ? signedUrl(a.storageKey, { ttlSec: 6 * 3600 }) : null;
  };

  if (comp) {
    const renders = await prisma.renderJob.findMany({ where: { compositionId: comp.id, kind: { in: ["single", "preview"] } }, orderBy: { createdAt: "desc" }, take: 20 });
    const versionOf = (r: (typeof renders)[number]) => (r.settings as { version?: number } | null)?.version;
    const current = (r: (typeof renders)[number]) => (versionOf(r) != null ? versionOf(r) === comp.version : r.createdAt >= comp.updatedAt);
    const fresh = renders.find((r) => r.status === "SUCCEEDED" && r.outputAssetId && current(r));
    if (fresh) return { url: await assetUrl(fresh.outputAssetId), kind: "export" as const, rendering: false, progress: 1 };

    let pending = renders.find((r) => (r.status === "QUEUED" || r.status === "RUNNING") && current(r));
    if (!pending) {
      pending = await prisma.renderJob.create({ data: { projectId: comp.projectId, compositionId: comp.id, kind: "preview", settings: { format: "720x1280", quality: "draft", version: comp.version } } });
      await enqueue("render", { renderJobId: pending.id }, { idempotencyKey: `render:${pending.id}`, maxAttempts: 2 });
    }
    // meanwhile: the newest older export, else the recording
    const older = renders.find((r) => r.status === "SUCCEEDED" && r.outputAssetId);
    const take = q.recording?.takes.find((t) => t.id === comp.takeId) ?? q.recording?.takes[0];
    const url = (older ? await assetUrl(older.outputAssetId) : null) ?? (await assetUrl(take?.normalizedAssetId));
    return { url, kind: older ? ("older-export" as const) : ("recording" as const), rendering: true, progress: pending.progress };
  }
  const take = q.recording?.takes.find((t) => t.id === selected) ?? q.recording?.takes[0];
  const url = await assetUrl(take?.normalizedAssetId);
  return url ? { url, kind: "recording" as const, rendering: false, progress: 1 } : null;
}
