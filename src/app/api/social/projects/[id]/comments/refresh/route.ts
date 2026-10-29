import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { projectAccess } from "@/lib/server/social/access";
import { enqueueSocial } from "@/lib/server/social/queue";

/** fetch comments of the project's recent publications now */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await projectAccess(id, "comments.view");
  const posts = await prisma.platformPost.findMany({ where: { projectId: id, status: "PUBLISHED", publishedAt: { gte: new Date(Date.now() - 90 * 86400e3) } }, select: { id: true }, take: 50, orderBy: { publishedAt: "desc" } });
  const bucket = Math.floor(Date.now() / 120_000);
  const jobs = [];
  for (const p of posts) jobs.push((await enqueueSocial("social-comments", { postId: p.id, projectId: id }, { idempotencyKey: `comments:${p.id}:manual:${bucket}` })).id);
  return json({ queued: jobs.length, jobIds: jobs }, 202);
});
