import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { parseAdsScript } from "@/lib/ads-script";

/**
 * The script file: one row per reel. Reels are matched by their id — an updated file changes their
 * texts (the edit stays until the reel is laid out again); reels no longer in the file are removed
 * unless they already have an edit.
 */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const { text } = z.object({ text: z.string().min(1).max(5_000_000) }).parse(await req.json());
  const { reels, errors } = parseAdsScript(text);
  if (!reels.length) return json({ error: errors[0] ?? "Nie znaleziono reelsów w pliku.", errors }, 400);
  await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true } });
  let created = 0;
  let updated = 0;
  for (const [i, r] of reels.entries()) {
    const existing = await prisma.adReel.findUnique({ where: { projectId_code: { projectId, code: r.code } } });
    const data = { title: r.title, parts: r.parts as unknown as Prisma.InputJsonValue, order: i };
    if (existing) {
      await prisma.adReel.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.adReel.create({ data: { projectId, code: r.code, ...data } });
      created++;
    }
  }
  const removed = await prisma.adReel.deleteMany({ where: { projectId, code: { notIn: reels.map((r) => r.code) }, compositionId: null } });
  return json({ created, updated, removed: removed.count, errors });
});
