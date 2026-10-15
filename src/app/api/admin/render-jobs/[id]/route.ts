import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { signedUrl } from "@/lib/server/storage";
import { enqueue } from "@/lib/server/jobs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const r = await prisma.renderJob.findUniqueOrThrow({ where: { id } });
  const out = r.outputAssetId ? await prisma.mediaAsset.findUnique({ where: { id: r.outputAssetId } }) : null;
  const job = await prisma.job.findUnique({ where: { idempotencyKey: `render:${r.id}` } });
  return json({
    id: r.id,
    status: (r.status === "QUEUED" || r.status === "RUNNING") && job?.status === "FAILED" ? "FAILED" : r.status,
    progress: r.progress,
    error: r.error ?? job?.error ?? null,
    // seconds since the last progress update — lets the UI explain a stall
    stalledSec: r.status === "RUNNING" ? Math.round((Date.now() - r.updatedAt.getTime()) / 1000) : 0,
    attempts: r.attempts,
    downloadUrl: out ? await signedUrl(out.storageKey, { download: out.originalName ?? "wideo.mp4" }) : null,
    previewUrl: out ? await signedUrl(out.storageKey) : null,
    duration: out?.durationSec ?? null,
    sizeBytes: out?.sizeBytes ?? null,
  });
});

/** Retry a failed render. */
export const POST = route(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const r = await prisma.renderJob.update({ where: { id }, data: { status: "QUEUED", error: null, progress: 0 } });
  await enqueue("render", { renderJobId: r.id }, { idempotencyKey: `render:${r.id}`, maxAttempts: 2 });
  return json({ ok: true });
});
