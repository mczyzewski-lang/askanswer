import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";
import { assetInfo } from "@/lib/server/assets";
import type { EditorDocument } from "@/lib/editor/types";

/**
 * Background blur: make sure every recording in the composition has a person mask. Ready masks come
 * back as assets; missing ones are queued (the client polls /api/admin/jobs/[id]).
 */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id }, select: { document: true } });
  const doc = comp.document as unknown as EditorDocument;
  const ids = [...new Set(doc.clips.map((c) => c.assetId))];
  const jobs: string[] = [];
  const ready = [];
  for (const assetId of ids) {
    const a = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
    if (!a) continue;
    const maskId = (a.meta as { maskAssetId?: string } | null)?.maskAssetId;
    if (maskId && (await prisma.mediaAsset.findUnique({ where: { id: maskId }, select: { id: true } }))) {
      ready.push(await assetInfo(assetId, true));
      continue;
    }
    const job = await enqueue("segment-asset", { assetId }, { idempotencyKey: `segment:${assetId}`, maxAttempts: 2 });
    jobs.push(job.id);
  }
  return json({ jobs, assets: ready.filter(Boolean) }, jobs.length ? 202 : 200);
});
