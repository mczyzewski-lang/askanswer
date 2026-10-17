import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";

/** "Napraw obraz": the edit master is made again from the original upload; the edit stays. */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const t = await prisma.recordingTake.findUniqueOrThrow({ where: { id } });
  if (!t.originalAssetId) return json({ error: "Nagranie nie zostało jeszcze w pełni wysłane" }, 409);
  await prisma.recordingTake.update({ where: { id }, data: { status: "UPLOADED", processingError: null, processingStep: "W kolejce do ponownej normalizacji" } });
  const job = await enqueue("process-take", { takeId: id, renormalize: true }, { idempotencyKey: `renormalize:${id}:${Date.now()}` });
  return json({ jobId: job.id });
});
