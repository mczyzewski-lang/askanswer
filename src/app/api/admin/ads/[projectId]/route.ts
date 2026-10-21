import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { deleteAssets } from "@/lib/server/assets";

/** Everything the Ads Studio page shows: footage (with processing state), reels with their matches. */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, format: true, themeId: true } });
  if (!project) return json({ error: "Nie ma takiej kampanii" }, 404);
  const footage = await prisma.adFootage.findMany({
    where: { projectId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, status: true, step: true, error: true, sizeBytes: true, durationSec: true, createdAt: true, words: true },
  });
  const reels = await prisma.adReel.findMany({ where: { projectId }, orderBy: { order: "asc" } });
  const comps = await prisma.videoComposition.findMany({ where: { id: { in: reels.map((r) => r.compositionId).filter((x): x is string => !!x) } }, select: { id: true, updatedAt: true } });
  const exists = new Set(comps.map((c) => c.id));
  return json({
    project,
    footage: footage.map(({ words, sizeBytes, ...f }) => ({ ...f, sizeBytes: Number(sizeBytes), words: Array.isArray(words) ? words.length : 0 })),
    reels: reels.map((r) => ({ id: r.id, code: r.code, groupCode: r.groupCode, title: r.title, parts: r.parts, matches: r.matches, hookIndex: r.hookIndex, compositionId: r.compositionId && exists.has(r.compositionId) ? r.compositionId : null })),
  });
});

/** Delete the campaign: reels, edits, renders and its files (raw footage takes the most space). */
export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, format: true } });
  if (project.format !== "ADS") return json({ error: "To nie jest kampania Ads Studio" }, 400);
  const assets = await prisma.mediaAsset.findMany({ where: { projectId }, select: { id: true } });
  await prisma.project.delete({ where: { id: projectId } });
  await deleteAssets(assets.map((a) => a.id));
  return json({ ok: true, files: assets.length });
});
