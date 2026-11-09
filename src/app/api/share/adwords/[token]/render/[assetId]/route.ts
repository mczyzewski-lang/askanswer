import { route } from "@/lib/server/http";
import { prisma } from "@/lib/server/db";
import { HttpError } from "@/lib/server/errors";
import { evaluateProject, renderAdwordsImage } from "@/lib/server/adwords";
import { shareHeaders, shareOf } from "@/lib/server/adwords-share";

export const runtime = "nodejs";

/** an image of the shared project (agency link): preview inline; a download only when the component passed the gates */
export const GET = route(async (req: Request, ctx: { params: Promise<{ token: string; assetId: string }> }) => {
  const { token, assetId } = await ctx.params;
  const s = await shareOf(token);
  const a = await prisma.adwordsAsset.findFirst({ where: { id: assetId, projectId: s.projectId, rowType: { in: ["image", "image_clean"] } }, select: { id: true } });
  if (!a) throw new HttpError(404, "Nie ma takiej grafiki");
  const url = new URL(req.url);
  const download = url.searchParams.get("download") === "1";
  const r = await renderAdwordsImage(assetId, url.searchParams.get("fmt") === "jpg" ? "jpg" : "png");
  if (download) {
    const ev = await evaluateProject(s.projectId, new Map([[assetId, r.measure]]), new Map([[assetId, r.buf.length]]));
    if (ev.images.find((x) => x.id === assetId)?.gate.status === "blokada") throw new HttpError(403, "Ta kreacja jest zablokowana — nie do publikacji.");
  }
  return new Response(new Uint8Array(r.buf), { headers: { ...shareHeaders, "Content-Type": r.mime, "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${r.fileName}"` } });
});
