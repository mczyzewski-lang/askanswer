import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { signedUrl } from "@/lib/server/storage";
import { deleteAssets } from "@/lib/server/assets";
import type { EduCut } from "@/lib/edu";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const e = await prisma.eduVideo.findUniqueOrThrow({ where: { id } });
  const [proxy, original, out] = await Promise.all([e.proxyAssetId, e.originalAssetId, e.exportAssetId].map((a) => (a ? prisma.mediaAsset.findUnique({ where: { id: a } }) : null)));
  const { words, ...rest } = e;
  return json({
    ...rest,
    words: Array.isArray(words) ? words.length : 0,
    proxyUrl: proxy ? await signedUrl(proxy.storageKey) : null,
    originalUrl: original ? await signedUrl(original.storageKey) : null,
    originalSize: original ? Number(original.sizeBytes) : Number(e.sizeBytes),
    export: out ? { url: await signedUrl(out.storageKey, { download: out.originalName ?? "edu.mp4" }), size: Number(out.sizeBytes), durationSec: out.durationSec } : null,
  });
});

/** Turn proposed cuts on / off, change the pause threshold, rename. */
export const PATCH = route(async (req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const b = z.object({ name: z.string().trim().min(1).max(200).optional(), pauseMin: z.number().min(0.6).max(10).optional(), enabled: z.record(z.string().max(64), z.boolean()).optional() }).parse(await req.json());
  const e = await prisma.eduVideo.findUniqueOrThrow({ where: { id } });
  const cuts = ((e.cuts as unknown as EduCut[] | null) ?? []).map((c) => (b.enabled && c.id in b.enabled ? { ...c, enabled: b.enabled[c.id] } : c));
  await prisma.eduVideo.update({ where: { id }, data: { ...(b.name ? { name: b.name } : {}), ...(b.pauseMin != null ? { pauseMin: b.pauseMin } : {}), cuts: cuts as unknown as Prisma.InputJsonValue } });
  return json({ ok: true });
});

export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const e = await prisma.eduVideo.findUniqueOrThrow({ where: { id } });
  await deleteAssets([e.originalAssetId, e.proxyAssetId, e.exportAssetId].filter((x): x is string => !!x)).catch(() => {});
  await prisma.eduVideo.delete({ where: { id } });
  return json({ ok: true });
});
