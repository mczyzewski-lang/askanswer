import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { narrationWords } from "@/lib/server/narration";
import { buildSegments } from "@/lib/editor/subtitles";

/** Subtitles of the narrator's question: word timings of the narration file (transcribed once). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const { assetId } = z.object({ assetId: z.string().min(1).max(64) }).parse(await req.json());
  await prisma.videoComposition.findUniqueOrThrow({ where: { id }, select: { id: true } });
  const { baseAssetId, words } = await narrationWords(assetId);
  return json({ baseAssetId, segments: buildSegments(baseAssetId, words) });
});
