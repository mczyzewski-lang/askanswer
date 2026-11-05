import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { accessibleProjects } from "@/lib/server/social/access";

/**
 * The project's Social Media schedule: the linked Social Media Studio project and its publications
 * (the last week and what is planned), plus the projects it can be linked to.
 */
export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireAdmin();
  const { id } = await ctx.params;
  const p = await prisma.project.findUniqueOrThrow({ where: { id }, select: { socialProjectId: true } });
  const options = (await accessibleProjects(me)).map((x) => ({ id: x.id, name: x.name, organization: x.organizationName, timezone: x.timezone }));
  const linked = p.socialProjectId ? await prisma.socialProject.findUnique({ where: { id: p.socialProjectId }, select: { id: true, name: true, timezone: true, organization: { select: { name: true } } } }) : null;
  const days = Math.min(180, Math.max(7, Number(new URL(req.url).searchParams.get("days")) || 60));
  const posts = linked
    ? await prisma.platformPost.findMany({
        where: { projectId: linked.id, status: { not: "DRAFT" }, OR: [{ scheduledAt: { gte: new Date(Date.now() - 7 * 86400e3), lt: new Date(Date.now() + days * 86400e3) } }, { publishedAt: { gte: new Date(Date.now() - 7 * 86400e3) } }] },
        orderBy: [{ scheduledAt: "asc" }],
        take: 300,
        select: {
          id: true,
          platform: true,
          status: true,
          scheduledAt: true,
          publishedAt: true,
          description: true,
          socialAccount: { select: { displayName: true, accountHandle: true } },
          contentItem: { select: { title: true, media: { select: { title: true } } } },
        },
      })
    : [];
  return json({
    linked: linked ? { id: linked.id, name: linked.name, organization: linked.organization.name, timezone: linked.timezone } : null,
    options,
    posts: posts.map((x) => ({
      id: x.id,
      platform: x.platform,
      status: x.status,
      at: x.publishedAt ?? x.scheduledAt,
      title: x.contentItem.title || x.contentItem.media.title || x.description.slice(0, 80),
      account: x.socialAccount.displayName ?? x.socialAccount.accountHandle ?? "",
    })),
  });
});

/** Link (or unlink) the Social Media Studio project. */
export const PUT = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireAdmin();
  const { id } = await ctx.params;
  const { socialProjectId } = z.object({ socialProjectId: z.string().max(64).nullable() }).parse(await req.json());
  if (socialProjectId && !(await accessibleProjects(me)).some((x) => x.id === socialProjectId)) return json({ error: "Nie masz dostępu do tego projektu w Social Media Studio" }, 403);
  await prisma.project.update({ where: { id }, data: { socialProjectId } });
  return json({ ok: true });
});
