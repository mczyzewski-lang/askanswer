import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { ensureComposition } from "@/lib/server/pipeline";

/** Open (or create) the editable composition for a take. */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const t = await prisma.recordingTake.findUniqueOrThrow({ where: { id } });
  if (!t.normalizedAssetId) return json({ error: "Nagranie jest jeszcze przetwarzane" }, 409);
  const c = await ensureComposition(id);
  return json({ id: c.id });
});
