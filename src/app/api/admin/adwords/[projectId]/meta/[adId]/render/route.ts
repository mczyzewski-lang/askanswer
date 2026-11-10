import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { renderMetaImage } from "@/lib/server/meta-ads";
import type { MetaFormatKey } from "@/lib/adwords/meta";

export const runtime = "nodejs";

/** one banner: ?format=square|feed|story&version=none|<photoId>&fmt=png|jpg&download=1 */
export const GET = route(async (req: Request, ctx: { params: Promise<{ projectId: string; adId: string }> }) => {
  await requireAdmin();
  const { projectId, adId } = await ctx.params;
  await prisma.metaAd.findFirstOrThrow({ where: { id: adId, projectId }, select: { id: true } });
  const q = new URL(req.url).searchParams;
  const r = await renderMetaImage(adId, (q.get("format") ?? "square") as MetaFormatKey, q.get("version") ?? "none", q.get("fmt") === "jpg" ? "jpg" : "png");
  return new Response(new Uint8Array(r.buf), { headers: { "Content-Type": r.mime, "Content-Disposition": `${q.get("download") === "1" ? "attachment" : "inline"}; filename="${r.fileName}"`, "Cache-Control": "no-store", "X-Render-Overflow": String(r.measure.overflow), "X-Render-Outside-Safe": String(r.measure.outsideSafe) } });
});
