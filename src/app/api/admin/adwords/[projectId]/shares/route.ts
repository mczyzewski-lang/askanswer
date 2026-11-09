import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { createShare } from "@/lib/server/adwords-share";

/** the agency links of a project */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  return json(await prisma.adwordsShare.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } }));
});

/** a new read-only link for an agency (no login) */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  const me = await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ label: z.string().trim().min(1).max(120), days: z.number().int().min(1).max(365).nullable().optional() }).parse(await req.json());
  return json(await createShare(projectId, b.label, b.days === undefined ? 30 : b.days, me.email), 201);
});
