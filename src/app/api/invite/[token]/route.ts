import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { hashPassword } from "@/lib/server/crypto";
import { json, route } from "@/lib/server/http";
import { SESSION_COOKIE, signSession } from "@/lib/server/session-token";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { findInvite } from "@/lib/server/social/projects";
import { audit } from "@/lib/server/social/audit";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  const inv = await findInvite(token);
  if (!inv) return json({ error: "Zaproszenie wygasło lub zostało już użyte." }, 404);
  const where = inv.projectId ? (await prisma.socialProject.findUnique({ where: { id: inv.projectId }, select: { name: true } }))?.name : (await prisma.organization.findUnique({ where: { id: inv.organizationId! }, select: { name: true } }))?.name;
  return json({ email: inv.email, name: inv.name, role: inv.role, where, kind: inv.projectId ? "project" : "organization" });
});

/** accept: create the account (role MEMBER: Social Media Studio only), join, log in */
export const POST = route(async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
  if (!rateLimit(`invite:${clientIp(req)}`, { capacity: 10, perMinute: 10 })) return json({ error: "Zbyt wiele prób." }, 429);
  const { token } = await ctx.params;
  const inv = await findInvite(token);
  if (!inv) return json({ error: "Zaproszenie wygasło lub zostało już użyte." }, 404);
  const b = z.object({ name: z.string().trim().min(2).max(120), password: z.string().min(10).max(200) }).parse(await req.json());
  if (await prisma.user.findUnique({ where: { email: inv.email } })) return json({ error: "Konto z tym adresem już istnieje — zaloguj się." }, 409);
  const user = await prisma.user.create({ data: { email: inv.email, name: b.name, passwordHash: await hashPassword(b.password), role: "MEMBER" } });
  if (inv.projectId) await prisma.socialProjectMember.create({ data: { projectId: inv.projectId, userId: user.id, role: inv.role } });
  else await prisma.organizationMember.create({ data: { organizationId: inv.organizationId!, userId: user.id, role: inv.role } });
  await prisma.userInvite.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
  await audit({ userId: user.id, organizationId: inv.organizationId, projectId: inv.projectId, action: "member.invite_accepted", entityType: "User", entityId: user.id, data: { role: inv.role } });
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await signSession({ uid: user.id, role: user.role }), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 7 * 24 * 3600 });
  return res;
});
