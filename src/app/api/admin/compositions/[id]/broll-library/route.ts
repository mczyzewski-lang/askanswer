import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { brollLibrary } from "@/lib/server/broll-library";
import { brollBasket } from "@/lib/server/ads";
import { assetInfo } from "@/lib/server/assets";

/** The project's B-roll library for the Studio (picked ones first). */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id }, select: { projectId: true } });
    const [items, basket] = await Promise.all([brollLibrary(comp.projectId), brollBasket(comp.projectId)]);
  // the basket (cut B-roll pieces) — to swap a cutaway in a reel for another one
  const urlOf = new Map(items.map((i) => [i.id, i.proxyUrl ?? i.url]));
    const assets = (await Promise.all([...new Set(basket.map((f) => f.assetId))].map((a) => assetInfo(a)))).filter(Boolean);
  return json({ items: [...items.filter((i) => i.picked), ...items.filter((i) => !i.picked)], basket: basket.map((f) => ({ ...f, url: urlOf.get(f.assetId) ?? null })), assets });
});
