import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { MetaBody } from "@/lib/server/meta-ads";

export const PATCH = route(async (req: Request, ctx: { params: Promise<{ projectId: string; adId: string }> }) => {
  await requireAdmin();
  const { projectId, adId } = await ctx.params;
  const raw = (await req.json()) as Record<string, unknown>;
  // only the fields sent (a partial schema would fill the others with their defaults)
  const parsed = MetaBody.partial().parse(raw);
  const b = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in raw)) as typeof parsed;
  await prisma.metaAd.findFirstOrThrow({ where: { id: adId, projectId } });
  const data = { ...b, ...(b.url !== undefined ? { url: b.url || null } : {}), ...(b.webinarAt !== undefined ? { webinarAt: b.webinarAt ? new Date(b.webinarAt) : null } : {}) };
  return json(await prisma.metaAd.update({ where: { id: adId }, data }));
});

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ projectId: string; adId: string }> }) => {
  await requireAdmin();
  const { projectId, adId } = await ctx.params;
  await prisma.metaAd.deleteMany({ where: { id: adId, projectId } });
  return json({ ok: true });
});
