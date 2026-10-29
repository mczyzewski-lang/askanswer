import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { projectAccess } from "@/lib/server/social/access";
import { accountView, startConnect } from "@/lib/server/social/accounts";
import { PLATFORMS } from "@/lib/social/platforms";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await projectAccess(id);
  const [accounts, profiles] = await Promise.all([prisma.socialAccount.findMany({ where: { projectId: id }, orderBy: [{ platform: "asc" }, { createdAt: "asc" }] }), prisma.providerProfile.findMany({ where: { projectId: id }, select: { id: true, username: true, label: true, lastSyncAt: true } })]);
  return json({ accounts: accounts.map(accountView), profiles });
});

/** "Połącz konto": the provider's hosted connect page (OAuth), back to /accounts/callback */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await projectAccess(id, "accounts.manage");
  const b = z.object({ platforms: z.array(z.enum(PLATFORMS as [string, ...string[]])).min(1).max(5), profileId: z.string().max(64).nullish() }).parse(await req.json());
  return json(await startConnect(id, b.platforms as never, a.user.id, b.profileId));
});
