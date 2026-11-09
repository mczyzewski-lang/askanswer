import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { SECTIONS } from "@/lib/adwords/landing-content";

const t = (n: number) => z.string().max(n).optional();
/** edit a block: texts, section, order, photo, hidden */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ projectId: string; blockId: string }> }) => {
  await requireAdmin();
  const { projectId, blockId } = await ctx.params;
  const b = z
    .object({
      landing_section: z.enum(SECTIONS).optional(),
      landing_order: z.number().int().min(0).max(999).optional(),
      landing_eyebrow: t(200),
      landing_social_proof: t(300),
      landing_h1: t(200),
      landing_h2: t(600),
      landing_bullets: t(3000),
      landing_primary_cta: t(120),
      landing_secondary_cta: t(120),
      landing_microcopy: t(600),
      landing_visual_direction: t(1000),
      landing_event: t(80),
      comparison_left: t(1000),
      comparison_right: t(1000),
      body: z.string().max(4000).optional(),
      hidden: z.boolean().optional(),
      photoId: z.string().max(64).nullable().optional(),
    })
    .parse(await req.json());
  const a = await prisma.adwordsAsset.findFirstOrThrow({ where: { id: blockId, projectId, rowType: "landing_page" } });
  const { body, hidden, photoId, landing_order, ...fields } = b;
  const lp: Record<string, string> = { ...((a.lp ?? {}) as Record<string, string>) };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) lp[k] = v;
  if (landing_order !== undefined) lp.landing_order = String(landing_order);
  if (hidden !== undefined) lp._hidden = hidden ? "true" : "false";
  if (photoId !== undefined) lp._photo_id = photoId ?? "";
  const u = await prisma.adwordsAsset.update({ where: { id: a.id }, data: { lp, ...(body !== undefined ? { body } : {}) } });
  return json(u);
});

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ projectId: string; blockId: string }> }) => {
  await requireAdmin();
  const { projectId, blockId } = await ctx.params;
  await prisma.adwordsAsset.deleteMany({ where: { id: blockId, projectId, rowType: "landing_page" } });
  return json({ ok: true });
});
