import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";
import { accountView } from "@/lib/server/social/accounts";
import { contentView } from "@/lib/server/social/content";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("content", id);
  const [view, accounts] = await Promise.all([contentView(id), prisma.socialAccount.findMany({ where: { projectId: a.project.id, connectionStatus: { not: "DISCONNECTED" } } })]);
  return json({ ...view, project: a.project, permissions: [...a.perms], accounts: accounts.map(accountView) });
});

export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await accessVia("content", id, "content.edit");
  const b = z.object({ title: z.string().max(300).optional(), goal: z.string().max(2000).optional() }).parse(await req.json());
  await prisma.contentItem.update({ where: { id }, data: b });
  return json({ ok: true });
});

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("content", id, "content.edit");
  const posts = await prisma.platformPost.findMany({ where: { contentItemId: id }, select: { id: true, status: true } });
  if (posts.some((p) => ["PUBLISHED", "PUBLISHING"].includes(p.status))) return json({ error: "Ten film ma już opublikowane posty — usuń tylko nieopublikowane cele." }, 409);
  const { removeTarget } = await import("@/lib/server/social/posts");
  for (const p of posts) await removeTarget(p.id, a.user.id);
  await prisma.contentItem.delete({ where: { id } });
  return json({ ok: true });
});
