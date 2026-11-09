import { requireAdmin } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { prisma } from "@/lib/server/db";
import { renderAdwordsImage } from "@/lib/server/adwords";

export const runtime = "nodejs";

/** One image creative as a real PNG / JPG (the same drawing as the preview), at its format's pixels. */
export const GET = route(async (req: Request, ctx: { params: Promise<{ projectId: string; assetId: string }> }) => {
  await requireAdmin();
  const { projectId, assetId } = await ctx.params;
  await prisma.adwordsAsset.findFirstOrThrow({ where: { id: assetId, projectId }, select: { id: true } });
  const url = new URL(req.url);
  const fmt = url.searchParams.get("fmt") === "jpg" ? "jpg" : "png";
  const r = await renderAdwordsImage(assetId, fmt);
  return new Response(new Uint8Array(r.buf), {
    headers: {
      "Content-Type": r.mime,
      "Content-Disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${r.fileName}"`,
      "Cache-Control": "no-store",
      "X-Image-Width": String(r.width),
      "X-Image-Height": String(r.height),
      "X-Render-Overflow": String(r.measure.overflow),
      "X-Render-Outside-Safe": String(r.measure.outsideSafe),
    },
  });
});
