import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import type { LandingSettings } from "@/lib/server/adwords-landing";

/** the variants' URL / name and the agency's URL strategy (Final URL expansion) */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  const me = await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z
    .object({
      variant: z.object({ id: z.string().regex(/^[A-Z0-9_]{2,40}$/), url: z.string().max(500).nullable().optional(), name: z.string().max(120).nullable().optional() }).optional(),
      urlStrategy: z.object({ finalUrlExpansion: z.enum(["on", "off", "unknown"]), exclusions: z.string().max(2000).optional() }).optional(),
    })
    .parse(await req.json());
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const cur = (p.adwordsLanding ?? { variants: {} }) as unknown as LandingSettings;
  const next: LandingSettings = { variants: { ...(cur.variants ?? {}) }, urlStrategy: cur.urlStrategy };
  if (b.variant) next.variants[b.variant.id] = { ...(next.variants[b.variant.id] ?? {}), ...(b.variant.url !== undefined ? { url: b.variant.url?.trim() || null } : {}), ...(b.variant.name !== undefined ? { name: b.variant.name } : {}) };
  if (b.urlStrategy) next.urlStrategy = { ...b.urlStrategy, checkedBy: me.email, checkedAt: new Date().toISOString() };
  await prisma.project.update({ where: { id: projectId }, data: { adwordsLanding: next as unknown as Prisma.InputJsonValue } });
  return json(next);
});
