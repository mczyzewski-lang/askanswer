import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";
import type { EditorDocument } from "@/lib/editor/types";

/** AI infographics for the reels already laid out (each edit once; the B-roll cutting edit is not a reel). */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const reels = await prisma.adReel.findMany({ where: { projectId, compositionId: { not: null } }, select: { compositionId: true } });
  const ids = [...new Set(reels.map((r) => r.compositionId!))];
  const comps = await prisma.videoComposition.findMany({ where: { id: { in: ids } }, select: { id: true, document: true } });
  let queued = 0;
  for (const c of comps) {
    if ((c.document as unknown as EditorDocument).meta.autoVisuals) continue;
    await enqueue("auto-visuals", { compositionId: c.id }, { idempotencyKey: `auto-visuals:${c.id}:laid:${Date.now()}`, maxAttempts: 2 });
    queued++;
  }
  return json({ queued });
});
