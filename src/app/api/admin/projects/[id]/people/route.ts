import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin, requireOwner } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

const ROLES = ["ADMIN", "EDITOR", "EXPERT", "VIEWER"] as const;
const person = { id: true, email: true, name: true, role: true, lastLoginAt: true } as const;

/** Who may open the project: the people given access, plus every administrator. */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireAdmin();
  const { id } = await ctx.params;
  const access = await prisma.projectAccess.findMany({ where: { projectId: id, user: { role: { not: "ADMIN" } } }, select: { user: { select: person } }, orderBy: { createdAt: "asc" } });
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: person, orderBy: { email: "asc" } });
  const others = me.role === "ADMIN" ? await prisma.user.findMany({ where: { role: { in: ["EDITOR", "EXPERT", "VIEWER"] }, projectAccess: { none: { projectId: id } } }, select: person, orderBy: { email: "asc" } }) : [];
  return json({ people: access.map((a) => a.user), admins, others, canManage: me.role === "ADMIN" });
});

/** Give someone access (an existing account, or a new one by e-mail — they sign in with Google). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireOwner();
  const { id } = await ctx.params;
  const b = z.union([z.object({ userId: z.string().max(64) }), z.object({ email: z.string().trim().toLowerCase().email(), name: z.string().trim().max(120).optional(), role: z.enum(ROLES) })]).parse(await req.json());
  let userId: string;
  if ("userId" in b) userId = b.userId;
  else {
    const found = await prisma.user.findUnique({ where: { email: b.email } });
    userId = found?.id ?? (await prisma.user.create({ data: { email: b.email, name: b.name || b.email.split("@")[0], role: b.role, passwordHash: "" } })).id;
  }
  await prisma.projectAccess.upsert({ where: { userId_projectId: { userId, projectId: id } }, create: { userId, projectId: id }, update: {} });
  return json({ ok: true, userId }, 201);
});

export const DELETE = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireOwner();
  const { id } = await ctx.params;
  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  await prisma.projectAccess.deleteMany({ where: { userId, projectId: id } });
  return json({ ok: true });
});
