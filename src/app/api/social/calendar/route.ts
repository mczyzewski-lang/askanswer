import { prisma } from "@/lib/server/db";
import { requireUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { postListInclude, postRow, scope } from "@/lib/server/social/lists";

/** publications with a date in [from, to), filtered by project / platform / account / status */
export const GET = route(async (req: Request) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const { ids, projects } = await scope(user, url);
  const from = new Date(url.searchParams.get("from") ?? Date.now() - 31 * 86400e3);
  const to = new Date(url.searchParams.get("to") ?? Date.now() + 62 * 86400e3);
  const platform = url.searchParams.get("platform");
  const account = url.searchParams.get("account");
  const status = url.searchParams.get("status");
  const posts = await prisma.platformPost.findMany({
    where: { projectId: { in: ids }, OR: [{ scheduledAt: { gte: from, lt: to } }, { publishedAt: { gte: from, lt: to } }], ...(platform ? { platform: platform as never } : {}), ...(account ? { socialAccountId: account } : {}), ...(status ? { status: { in: status.split(",") as never } } : {}) },
    include: postListInclude,
    orderBy: { scheduledAt: "asc" },
    take: 1000,
  });
  const accounts = await prisma.socialAccount.findMany({ where: { projectId: { in: ids } }, select: { id: true, platform: true, displayName: true, accountHandle: true, projectId: true } });
  return json({ posts: await Promise.all(posts.map(postRow)), projects: projects.map((p) => ({ id: p.id, name: p.name, timezone: p.timezone, roles: p.roles })), accounts });
});
