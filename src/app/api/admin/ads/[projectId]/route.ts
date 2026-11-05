import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { deleteAssets } from "@/lib/server/assets";
import { ownTheme } from "@/lib/server/ads";

/** Everything the Ads Studio page shows: footage (with processing state), reels with their matches. */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const p = await prisma.project.findUnique({ where: { id: projectId }, include: { theme: true } });
  if (!p) return json({ error: "Nie ma takiej kampanii" }, 404);
  // campaigns from before: a read-only preset (or no) theme → their own editable copy
  if (!p.theme || p.theme.isPreset) {
    const t = await ownTheme(p.name, { themeId: p.theme?.id ?? null });
    await prisma.project.update({ where: { id: p.id }, data: { themeId: t.id } });
    p.theme = t;
    p.themeId = t.id;
  }
  const project = {
    id: p.id,
    name: p.name,
    format: p.format,
    themeId: p.themeId,
    theme: { id: p.theme.id, name: p.theme.name, questionStyle: p.theme.questionStyle, questionPosition: p.theme.questionPosition, primaryColor: p.theme.primaryColor, accentColor: p.theme.accentColor, highlightColor: p.theme.highlightColor, backgroundColor: p.theme.backgroundColor, textColor: p.theme.textColor },
    subtitlePreset: p.subtitlePreset,
    ctaEnabled: p.ctaEnabled,
    ctaUrl: p.ctaUrl,
    ctaText: p.ctaText,
    ctaSeconds: p.ctaSeconds,
    ctaPlacement: p.ctaPlacement,
        autoBlur: p.autoBlur,
    blurStrength: p.blurStrength,
    autoInfographics: p.autoInfographics,
    adsBrief: p.adsBrief,
    leadMagnets: p.leadMagnets,
    adsFormat: p.adsFormat ?? "[EKSPERT]",
    adsBrollPerReel: p.adsBrollPerReel,
    autoReels: p.autoReels,
    autoReelsCount: p.autoReelsCount,
    autoReelsMin: p.autoReelsMin,
    autoReelsMax: p.autoReelsMax,
    autoReelsStatus: p.autoReelsStatus,
    autoReelsStep: p.autoReelsStep,
    autoReelsError: p.autoReelsError,
    autoZooms: p.autoZooms,
  };
  const footage = await prisma.adFootage.findMany({
    where: { projectId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, status: true, step: true, error: true, sizeBytes: true, durationSec: true, createdAt: true, words: true },
  });
  const reels = await prisma.adReel.findMany({ where: { projectId }, orderBy: { order: "asc" } });
  const comps = await prisma.videoComposition.findMany({ where: { id: { in: reels.map((r) => r.compositionId).filter((x): x is string => !!x) } }, select: { id: true, updatedAt: true, ...(p.autoReels ? { document: true } : {}) } });
  const exists = new Set(comps.map((c) => c.id));
  // Auto Reels: the length of each reel as laid out (after the pauses were cut)
  const lengthOf = new Map(
    comps.map((c) => {
      const d = (c as { document?: { clips?: Array<{ start: number; sourceIn: number; sourceOut: number }> } }).document;
      return [c.id, d?.clips?.length ? Math.max(...d.clips.map((x) => x.start + x.sourceOut - x.sourceIn)) : null] as const;
    }),
  );
  return json({
    project,
    footage: footage.map(({ words, sizeBytes, ...f }) => ({ ...f, sizeBytes: Number(sizeBytes), words: Array.isArray(words) ? words.length : 0 })),
    reels: reels.map((r) => ({ id: r.id, code: r.code, groupCode: r.groupCode, title: r.title, parts: r.parts, matches: r.matches, review: r.review, reviewedAt: r.reviewedAt, hookIndex: r.hookIndex, autoScore: r.autoScore, autoReason: r.autoReason, durationSec: r.compositionId ? (lengthOf.get(r.compositionId) ?? null) : null, compositionId: r.compositionId && exists.has(r.compositionId) ? r.compositionId : null })),
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
