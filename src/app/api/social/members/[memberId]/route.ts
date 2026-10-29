import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { HttpError } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { orgAccess, projectAccess } from "@/lib/server/social/access";
import { audit } from "@/lib/server/social/audit";
import { ORG_ROLES } from "@/lib/social/rbac";

/** a membership (organization or project): change role / remove. ?scope=org|project */
async function load(req: Request, memberId: string) {
  const scope = new URL(req.url).searchParams.get("scope") === "project" ? "project" : "org";
  if (scope === "org") {
    const m = await prisma.organizationMember.findUnique({ where: { id: memberId } });
    if (!m) throw new HttpError(404, "Nie znaleziono");
    const a = await orgAccess(m.organizationId, "members.manage");
    return { scope, m, a, orgId: m.organizationId, projectId: null as string | null };
  }
  const m = await prisma.socialProjectMember.findUnique({ where: { id: memberId } });
  if (!m) throw new HttpError(404, "Nie znaleziono");
  const a = await projectAccess(m.projectId, "members.manage");
  return { scope, m, a, orgId: a.project.organizationId, projectId: m.projectId };
}

export const PATCH = route(async (req: Request, ctx: { params: Promise<{ memberId: string }> }) => {
  const { memberId } = await ctx.params;
  const { scope, m, a, orgId, projectId } = await load(req, memberId);
  const b = z.object({ role: z.enum(ORG_ROLES as [string, ...string[]]) }).parse(await req.json());
  const isOwner = "role" in a ? a.role === "OWNER" : a.roles.includes("OWNER");
  if ((b.role === "OWNER" || m.role === "OWNER") && !isOwner) throw new HttpError(403, "Rolę właściciela zmienia tylko właściciel.");
  if (scope === "org") await prisma.organizationMember.update({ where: { id: memberId }, data: { role: b.role as never } });
  else await prisma.socialProjectMember.update({ where: { id: memberId }, data: { role: b.role as never } });
  await audit({ userId: a.user.id, organizationId: orgId, projectId, action: "member.role_changed", entityType: "Member", entityId: memberId, data: { role: b.role } });
  return json({ ok: true });
});

export const DELETE = route(async (req: Request, ctx: { params: Promise<{ memberId: string }> }) => {
  const { memberId } = await ctx.params;
  const { scope, m, a, orgId, projectId } = await load(req, memberId);
  if (scope === "org" && m.role === "OWNER") {
    const owners = await prisma.organizationMember.count({ where: { organizationId: orgId, role: "OWNER" } });
    if (owners <= 1) throw new HttpError(409, "Organizacja musi mieć co najmniej jednego właściciela.");
  }
  if (scope === "org") await prisma.organizationMember.delete({ where: { id: memberId } });
  else await prisma.socialProjectMember.delete({ where: { id: memberId } });
  await audit({ userId: a.user.id, organizationId: orgId, projectId, action: "member.removed", entityType: "Member", entityId: memberId });
  return json({ ok: true });
});
