import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { narrationAtSpeed } from "@/lib/server/narration";
import { assetInfo } from "@/lib/server/assets";

/** The question narration faster / slower (pitch kept); the Studio then fits the timeline to it. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const b = z.object({ baseAssetId: z.string().min(1).max(64), speed: z.number().min(0.8).max(1.6) }).parse(await req.json());
  await prisma.videoComposition.findUniqueOrThrow({ where: { id }, select: { id: true } });
  const base = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: b.baseAssetId } });
  // narration files are a shared TTS cache (any project), so only the kind is checked
  if (base.kind !== "NARRATION") return json({ error: "To nie jest nagranie lektora" }, 400);
  return json(await assetInfo(await narrationAtSpeed(base.id, b.speed)));
});
