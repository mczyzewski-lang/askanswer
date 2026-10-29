import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { projectAccess } from "@/lib/server/social/access";
import { accountView } from "@/lib/server/social/accounts";
import { deleteProject } from "@/lib/server/social/projects";
import { audit } from "@/lib/server/social/audit";

/** project overview: accounts, counts, key results 7 / 30 days */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await projectAccess(id);
  const [project, statusCounts, unreadComments, accounts, members] = await Promise.all([
    prisma.socialProject.findUniqueOrThrow({ where: { id }, include: { organization: { select: { id: true, name: true } } } }),
    prisma.platformPost.groupBy({ by: ["status"], where: { projectId: id }, _count: true }),
    prisma.socialComment.count({ where: { projectId: id, isOwn: false, readAt: null, status: { in: ["NEW", "NEEDS_REPLY", "ESCALATED"] } } }),
    prisma.socialAccount.findMany({ where: { projectId: id }, orderBy: [{ platform: "asc" }, { createdAt: "asc" }] }),
    a.perms.has("members.manage") ? prisma.socialProjectMember.findMany({ where: { projectId: id }, include: { user: { select: { id: true, email: true, name: true } } } }) : Promise.resolve([]),
  ]);
  const count = (s: string[]) => statusCounts.filter((c) => s.includes(c.status)).reduce((n, c) => n + c._count, 0);
  const results = async (days: number) => {
    const since = new Date(Date.now() - days * 86400e3);
    const posts = await prisma.platformPost.findMany({ where: { projectId: id, status: "PUBLISHED", publishedAt: { gte: since } }, select: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1, select: { views: true, likes: true, comments: true, shares: true, saves: true, capturedAt: true } } } });
    const ls = posts.map((p) => p.snapshots[0]).filter(Boolean);
    const sum = (k: "views" | "likes" | "comments" | "shares" | "saves") => (ls.some((s) => s[k] !== null) ? ls.reduce((n, s) => n + (s[k] ?? 0), 0) : null);
    return { published: posts.length, views: sum("views"), interactions: ls.some((s) => s.likes !== null || s.comments !== null) ? (sum("likes") ?? 0) + (sum("comments") ?? 0) + (sum("shares") ?? 0) + (sum("saves") ?? 0) : null, lastUpdated: ls.length ? new Date(Math.max(...ls.map((s) => s.capturedAt.getTime()))).toISOString() : null };
  };
  return json({
    project: { id: project.id, name: project.name, timezone: project.timezone, language: project.language, isDemo: project.isDemo, organization: project.organization },
    permissions: [...a.perms],
    roles: a.roles,
    counts: { accounts: accounts.filter((x) => x.connectionStatus === "CONNECTED").length, scheduled: count(["SCHEDULED", "SCHEDULING"]), published: count(["PUBLISHED"]), pendingApproval: count(["PENDING_APPROVAL"]), failed: count(["SCHEDULING_FAILED", "PUBLISH_FAILED", "REAUTH_REQUIRED"]), unreadComments },
    results: { d7: await results(7), d30: await results(30) },
    accounts: accounts.map(accountView),
    members: members.map((m) => ({ id: m.id, role: m.role, user: m.user })),
  });
});

export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await projectAccess(id, "brand.edit");
  const b = z.object({ name: z.string().trim().min(2).max(120).optional(), timezone: z.string().max(60).optional(), language: z.enum(["pl", "en"]).optional() }).parse(await req.json());
  if (b.timezone) Intl.DateTimeFormat("pl-PL", { timeZone: b.timezone });
  await prisma.socialProject.update({ where: { id }, data: b });
  await audit({ userId: a.user.id, projectId: id, action: "project.updated", entityType: "SocialProject", entityId: id, data: b });
  return json({ ok: true });
});

/** delete the project and ALL its data (GDPR): orders cancelled, provider profiles and files removed */
export const DELETE = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await projectAccess(id, "project.delete");
  const b = z.object({ confirm: z.string() }).parse(await req.json().catch(() => ({})));
  if (b.confirm !== a.project.name) return json({ error: "Wpisz dokładną nazwę projektu, aby potwierdzić usunięcie." }, 400);
  await deleteProject(id, a.user.id);
  return json({ ok: true });
});
