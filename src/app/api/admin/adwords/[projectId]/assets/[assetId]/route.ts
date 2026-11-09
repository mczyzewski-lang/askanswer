import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { HttpError } from "@/lib/server/errors";
import { groupOf } from "@/lib/adwords/csv";
import { syncScriptColumns } from "@/lib/server/adwords";

const text = (n: number) => z.string().max(n).nullable().optional();
const Body = z.object({
  headline: text(200),
  subheadline: text(300),
  body: text(600),
  cta: text(80),
  adText: text(500),
  spokenText: text(3000),
  screenText: text(300),
  visualBrief: text(1000),
  landingUrl: z.string().url().max(500).nullable().optional().or(z.literal("").transform(() => null)),
  claimSource: text(500),
  layout: z.enum(["typographic", "expert_split", "process_steps", "comparison", "infographic"]).nullable().optional(),
  /** CSV v5 fields of a group (comparison_*, historical_*, test_*, video_*…) — merged; "" removes */
  lp: z.record(z.string().regex(/^[a-z0-9_]{1,60}$/), z.string().max(4000)).optional(),
  testPriority: z.number().int().min(0).max(999).nullable().optional(),
  expertPhotoId: z.string().max(64).nullable().optional(),
  startS: z.number().min(0).max(3600).nullable().optional(),
  endS: z.number().min(0).max(3600).nullable().optional(),
  durationSec: z.number().min(0).max(3600).nullable().optional(),
  edit: z.object({ photoHidden: z.boolean().optional(), zoom: z.number().min(1).max(4).optional(), offsetX: z.number().min(-0.5).max(0.5).optional(), offsetY: z.number().min(-0.5).max(0.5).optional(), cleanPhoto: z.boolean().optional() }).optional(),
  /** confirm (or withdraw) the claim / source of a component that needs approval */
  approve: z.boolean().optional(),
  /** apply the same copy / layout / photo to every format of the concept */
  allFormats: z.boolean().optional(),
});

export const PATCH = route(async (req: Request, ctx: { params: Promise<{ projectId: string; assetId: string }> }) => {
  const me = await requireAdmin();
  const { projectId, assetId } = await ctx.params;
  const b = Body.parse(await req.json());
  const a = await prisma.adwordsAsset.findFirstOrThrow({ where: { id: assetId, projectId } });
  const { approve, allFormats, edit, lp, ...fields } = b;
  if (lp && Object.keys(lp).some((k) => !groupOf(k))) throw new HttpError(400, "Nieznane pole v5");
  const data: Prisma.AdwordsAssetUpdateInput = { ...fields };
  if (edit) data.edit = { ...((a.edit ?? {}) as object), ...edit } as Prisma.InputJsonValue;
  if (approve != null) Object.assign(data, approve ? { approvedAt: new Date(), approvedBy: me.email } : { approvedAt: null, approvedBy: null });
  const ids = allFormats && a.conceptId && (a.rowType === "image" || a.rowType === "image_clean") ? (await prisma.adwordsAsset.findMany({ where: { projectId, conceptId: a.conceptId, rowType: a.rowType }, select: { id: true } })).map((x) => x.id) : [a.id];
  for (const id of ids) {
    // the crop / edit of other formats keeps their own values except what was changed now
    const cur = id === a.id ? a : await prisma.adwordsAsset.findUniqueOrThrow({ where: { id } });
    const lpNext = lp ? Object.fromEntries(Object.entries({ ...((cur.lp ?? {}) as Record<string, string>), ...lp }).filter(([, v]) => v !== "")) : null;
    await prisma.adwordsAsset.update({ where: { id }, data: { ...data, ...(edit ? { edit: { ...((cur.edit ?? {}) as object), ...edit } as Prisma.InputJsonValue } : {}), ...(lpNext ? { lp: lpNext } : {}) } });
  }
  // an edited scene of a CSV video script: the script columns of its video rows follow
  if (a.rowType === "video_scene") await syncScriptColumns(projectId, a.conceptId);
  return json({ ok: true, updated: ids.length });
});

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ projectId: string; assetId: string }> }) => {
  await requireAdmin();
  const { projectId, assetId } = await ctx.params;
  const a = await prisma.adwordsAsset.findFirst({ where: { id: assetId, projectId } });
  await prisma.adwordsAsset.deleteMany({ where: { id: assetId, projectId } });
  if (a?.rowType === "video_scene") await syncScriptColumns(projectId, a.conceptId);
  return json({ ok: true });
});
