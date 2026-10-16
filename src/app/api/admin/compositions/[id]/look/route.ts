import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { analyzeLook } from "@/lib/server/look";
import type { EditorDocument, PictureLook } from "@/lib/editor/types";

/** "Magiczna poprawa obrazu": the correction for every recording of the composition (measured once). */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id }, select: { document: true } });
  const doc = comp.document as unknown as EditorDocument;
  const looks: Record<string, PictureLook> = {};
  for (const a of [...new Set(doc.clips.map((c) => c.assetId))]) looks[a] = await analyzeLook(a);
  return json({ looks });
});
