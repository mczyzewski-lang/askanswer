import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";
import { startConnect } from "@/lib/server/social/accounts";

/** "Połącz ponownie": the same profile's connect page for this platform */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("account", id, "accounts.manage");
  const acc = await prisma.socialAccount.findUniqueOrThrow({ where: { id } });
  return json(await startConnect(acc.projectId, [acc.platform as never], a.user.id, acc.providerProfileId));
});
