import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { orgAccess } from "@/lib/server/social/access";
import { audit } from "@/lib/server/social/audit";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ orgId: string }> }) => {
  const { orgId } = await ctx.params;
  const a = await orgAccess(orgId);
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    include: { members: { include: { user: { select: { id: true, email: true, name: true } } }, orderBy: { createdAt: "asc" } }, projects: { select: { id: true, name: true, isDemo: true, timezone: true, _count: { select: { accounts: true } } }, orderBy: { name: "asc" } } },
  });
  const invites = a.perms.has("members.manage") ? await prisma.userInvite.findMany({ where: { organizationId: orgId, acceptedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, email: true, role: true, expiresAt: true } }) : [];
  return json({ id: org.id, name: org.name, isDemo: org.isDemo, role: a.role, permissions: [...a.perms], members: org.members.map((m) => ({ id: m.id, role: m.role, user: m.user })), projects: org.projects.map((p) => ({ id: p.id, name: p.name, isDemo: p.isDemo, timezone: p.timezone, accounts: p._count.accounts })), invites });
});

export const PATCH = route(async (req: Request, ctx: { params: Promise<{ orgId: string }> }) => {
  const { orgId } = await ctx.params;
  const a = await orgAccess(orgId, "members.manage");
  const b = z.object({ name: z.string().trim().min(2).max(120) }).parse(await req.json());
  await prisma.organization.update({ where: { id: orgId }, data: { name: b.name } });
  await audit({ userId: a.user.id, organizationId: orgId, action: "org.renamed", entityType: "Organization", entityId: orgId, data: b });
  return json({ ok: true });
});
