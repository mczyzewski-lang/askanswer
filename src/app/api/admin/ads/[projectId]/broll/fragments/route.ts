import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { BROLL_MAX_SHOT } from "@/lib/editor/broll-basket";

const Body = z.union([
  z.object({ assetId: z.string().max(64), sourceIn: z.number().min(0), sourceOut: z.number().positive() }),
  /** cut the whole video into pieces of `length` seconds, one every `every` seconds */
  z.object({ assetId: z.string().max(64), auto: z.object({ length: z.number().min(1).max(BROLL_MAX_SHOT), every: z.number().min(1).max(60) }) }),
]);

/** Add pieces of a B-roll video to the campaign's basket (reels draw cutaways from it at random). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = Body.parse(await req.json());
  const a = await prisma.mediaAsset.findFirst({ where: { id: b.assetId, projectId, kind: "OVERLAY_VIDEO" } });
  if (!a || (a.meta as { library?: string } | null)?.library !== "broll") return json({ error: "To nie jest wideo z biblioteki B-roll tej kampanii" }, 400);
  const dur = a.durationSec ?? 0;
  const ranges: Array<[number, number]> = [];
  if ("auto" in b) {
    for (let t = 0; t + b.auto.length <= dur + 0.01 && ranges.length < 60; t += b.auto.every) ranges.push([t, Math.min(dur, t + b.auto.length)]);
  } else {
    const from = Math.min(b.sourceIn, Math.max(0, dur - 0.5));
    const to = Math.min(b.sourceOut, dur || b.sourceOut);
    if (to - from < 0.5) return json({ error: "Fragment musi mieć co najmniej 0,5 s" }, 400);
    ranges.push([from, Math.min(to, from + 10)]);
  }
  if (!ranges.length) return json({ error: "Wideo jest za krótkie na fragment tej długości" }, 400);
  const round = (x: number) => Math.round(x * 100) / 100;
  await prisma.brollFragment.createMany({ data: ranges.map(([s, e]) => ({ projectId, assetId: a.id, sourceIn: round(s), sourceOut: round(e) })) });
  return json({ added: ranges.length }, 201);
});
