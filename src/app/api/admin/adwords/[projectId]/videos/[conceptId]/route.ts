import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";
import { signedUrl } from "@/lib/server/storage";

/** Render the concept's storyboard video (animatic) in its orientations — a background job. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string; conceptId: string }> }) => {
  await requireAdmin();
  const { projectId, conceptId } = await ctx.params;
  const { voice } = z.object({ voice: z.boolean().default(true) }).parse(await req.json().catch(() => ({})));
  const n = await prisma.adwordsAsset.count({ where: { projectId, conceptId, rowType: "video_scene" } });
  if (!n) return json({ error: "Ten koncept nie ma scen" }, 400);
  const job = await enqueue("adwords-video", { projectId, conceptId, voice }, { idempotencyKey: `adwords-video:${projectId}:${conceptId}:${Date.now()}`, maxAttempts: 1 });
  return json({ jobId: job.id }, 202);
});

/** The last rendered files of the concept (per variant). */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ projectId: string; conceptId: string }> }) => {
  await requireAdmin();
  const { projectId, conceptId } = await ctx.params;
  const variants = await prisma.adwordsAsset.findMany({ where: { projectId, conceptId, rowType: "video" } });
  const files = [];
  for (const v of variants) {
    const e = (v.edit ?? {}) as { renderAssetId?: string; renderedAt?: string; voiced?: boolean };
    if (!e.renderAssetId) continue;
    const a = await prisma.mediaAsset.findUnique({ where: { id: e.renderAssetId } });
    if (!a) continue;
    files.push({ variant: v.assetKey, aspectRatio: v.aspectRatio, width: a.width, height: a.height, duration: a.durationSec, bytes: Number(a.sizeBytes), voiced: !!e.voiced, renderedAt: e.renderedAt, url: await signedUrl(a.storageKey, { download: a.originalName ?? `${v.assetKey}.mp4` }), preview: await signedUrl(a.storageKey) });
  }
  return json({ files });
});
