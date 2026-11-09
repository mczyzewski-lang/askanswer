import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { SECTIONS } from "@/lib/adwords/landing-content";

/** add a block (a section) to a landing page variant — optionally a copy of another block */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ variantId: z.string().regex(/^[A-Z0-9_]{2,40}$/), section: z.enum(SECTIONS), copyOf: z.string().max(64).optional(), order: z.number().int().min(0).max(999).optional() }).parse(await req.json());
  const src = b.copyOf ? await prisma.adwordsAsset.findFirst({ where: { id: b.copyOf, projectId, rowType: "landing_page" } }) : null;
  const n = await prisma.adwordsAsset.count({ where: { projectId, rowType: "landing_page" } });
  let key = `${b.variantId}-${b.section}`;
  for (let i = 2; await prisma.adwordsAsset.findUnique({ where: { projectId_assetKey: { projectId, assetKey: key } } }); i++) key = `${b.variantId}-${b.section}-${i}`;
  const lp = { ...((src?.lp ?? {}) as Record<string, string>), landing_section: b.section, landing_order: String(b.order ?? ((src?.lp as Record<string, string> | null)?.landing_order ? Number((src!.lp as Record<string, string>).landing_order) : 50)) };
  const a = await prisma.adwordsAsset.create({ data: { projectId, assetKey: key, rowType: "landing_page", recordScope: "landing_content", landingVariantId: b.variantId, body: src?.body ?? null, campaignCode: src?.campaignCode ?? null, landingUrl: src?.landingUrl ?? null, lp, order: 20_000 + n } });
  return json(a, 201);
});
