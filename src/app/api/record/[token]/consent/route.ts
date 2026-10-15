import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { resolveToken } from "@/lib/server/invitations";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  const inv = await resolveToken(token);
  if (!inv.consentAt) await prisma.invitation.update({ where: { id: inv.id }, data: { consentAt: new Date() } });
  return json({ ok: true });
});
