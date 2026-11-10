import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { MetaBody } from "@/lib/server/meta-ads";

/** the Meta ads of the project */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  return json(await prisma.metaAd.findMany({ where: { projectId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] }));
});

export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = MetaBody.parse(await req.json());
  const n = await prisma.metaAd.count({ where: { projectId } });
  return json(await prisma.metaAd.create({ data: { ...b, url: b.url || null, webinarAt: b.webinarAt ? new Date(b.webinarAt) : null, projectId, order: n } }), 201);
});
