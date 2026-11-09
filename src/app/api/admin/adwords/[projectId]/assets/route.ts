import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { ROW_TYPES } from "@/lib/adwords/csv";

/** Add a component (e.g. a new headline) by hand. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ rowType: z.enum(ROW_TYPES), assetKey: z.string().trim().min(1).max(80).optional(), adText: z.string().max(500).optional(), campaignCode: z.string().max(80).nullable().optional(), assetGroup: z.string().max(80).nullable().optional(), conceptId: z.string().max(80).nullable().optional() }).parse(await req.json());
  const n = await prisma.adwordsAsset.count({ where: { projectId, rowType: b.rowType } });
  const prefix = { headline: "H", long_headline: "LH", description: "D", image: "G", image_clean: "GC", video: "V", video_scene: "VS", sitelink: "S", experiment_plan: "EXP", historical_reference: "HIST", landing_page: "LP" }[b.rowType];
  let key = b.assetKey ?? `${prefix}${String(n + 1).padStart(2, "0")}`;
  for (let i = 2; !b.assetKey && (await prisma.adwordsAsset.findUnique({ where: { projectId_assetKey: { projectId, assetKey: key } } })); i++) key = `${prefix}${String(n + i).padStart(2, "0")}`;
  const a = await prisma.adwordsAsset.create({ data: { projectId, assetKey: key, rowType: b.rowType, adText: b.adText ?? "", campaignCode: b.campaignCode ?? null, assetGroup: b.assetGroup ?? null, conceptId: b.conceptId ?? null, order: 10_000 + n } });
  return json(a, 201);
});
