import { z } from "zod";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { deleteAssets } from "@/lib/server/assets";
import { prisma } from "@/lib/server/db";
import { setPicked } from "@/lib/server/broll-library";

/** Pick / unpick a cutaway for the Studio. */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ assetId: string }> }) => {
  await requireAdmin();
  const { assetId } = await ctx.params;
  const { picked } = z.object({ picked: z.boolean() }).parse(await req.json());
  await setPicked(assetId, picked);
  return json({ ok: true });
});

/** Remove from the library (reels that already use it keep a reference until edited). */
export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ assetId: string }> }) => {
  await requireAdmin();
  const { assetId } = await ctx.params;
  const a = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
  if ((a.meta as { library?: string } | null)?.library !== "broll") return json({ error: "To nie jest plik z biblioteki B-roll" }, 400);
  // used in an edit? then it stays in storage (only leaves the library)
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "VideoComposition" WHERE "projectId" = ${a.projectId ?? ""} AND document::text LIKE ${"%" + assetId + "%"}`;
  const used = Number(rows[0]?.n ?? 0);
  if (used) await prisma.mediaAsset.update({ where: { id: assetId }, data: { meta: { ...((a.meta as object) ?? {}), library: "broll-removed" } } });
  else await deleteAssets([assetId]);
  return json({ ok: true });
});
