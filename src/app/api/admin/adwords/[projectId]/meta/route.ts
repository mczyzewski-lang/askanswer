import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { MetaBody } from "@/lib/server/meta-ads";
import { signedUrl } from "@/lib/server/storage";

/** the Meta ads of the project */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const ads = await prisma.metaAd.findMany({ where: { projectId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  // the AI infographic pictures through signed links (for the preview)
  const ids = ads.flatMap((a) => Object.values((a.infographic ?? {}) as Record<string, string>));
  const urls = new Map(await Promise.all((await prisma.mediaAsset.findMany({ where: { id: { in: ids } } })).map(async (m) => [m.id, await signedUrl(m.storageKey, { ttlSec: 6 * 3600 })] as const)));
  return json(ads.map((a) => ({ ...a, infographicUrls: Object.fromEntries(Object.entries((a.infographic ?? {}) as Record<string, string>).map(([k, id]) => [k, urls.get(id) ?? null])) })));
});

export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = MetaBody.parse(await req.json());
  const n = await prisma.metaAd.count({ where: { projectId } });
  return json(await prisma.metaAd.create({ data: { ...b, extra: b.extra ?? Prisma.JsonNull, url: b.url || null, webinarAt: b.webinarAt ? new Date(b.webinarAt) : null, projectId, order: n } }), 201);
});
