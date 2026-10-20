import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";
import { deleteAssets } from "@/lib/server/assets";

/** Remove a footage file (reels already laid out keep working until laid out again). */
export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const f = await prisma.adFootage.findUniqueOrThrow({ where: { id } });
  await prisma.adFootage.delete({ where: { id } });
  // the files stay while an edit uses them; only the original upload goes
  await deleteAssets([f.originalAssetId]);
  return json({ ok: true });
});

/** Retry processing (e.g. after adding the ElevenLabs key). */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const f = await prisma.adFootage.findUniqueOrThrow({ where: { id } });
  if (!f.originalAssetId) return json({ error: "Plik nie został w pełni wysłany" }, 409);
  await prisma.adFootage.update({ where: { id }, data: { status: "PROCESSING", error: null, step: "W kolejce" } });
  await enqueue("ads-footage", { footageId: id }, { idempotencyKey: `ads-footage:${id}:${Date.now()}`, maxAttempts: 2 });
  return json({ ok: true });
});
