import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

/** Exploration (B added to the pool) or Controlled (PMax asset A/B experiment) for a whole experiment. */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ projectId: string; experimentId: string }> }) => {
  await requireAdmin();
  const { projectId, experimentId } = await ctx.params;
  const { deployMode } = z.object({ deployMode: z.enum(["exploration", "controlled"]) }).parse(await req.json());
  const r = await prisma.adwordsAsset.updateMany({ where: { projectId, experimentId }, data: { deployMode } });
  return json({ ok: true, updated: r.count });
});
