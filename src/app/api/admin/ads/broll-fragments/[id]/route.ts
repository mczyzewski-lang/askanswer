import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

/** Take a piece out of the basket (reels already laid out keep their cutaways). */
export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  await prisma.brollFragment.deleteMany({ where: { id } });
  return json({ ok: true });
});
