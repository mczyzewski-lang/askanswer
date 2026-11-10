import { z } from "zod";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { applyProposals, proposeContent } from "@/lib/server/adwords-propose";

export const maxDuration = 180;

/** the analysis + new content proposals (nothing is saved) */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  return json(await proposeContent(projectId));
});

const P = z.object({ kind: z.enum(["headline", "long_headline", "description", "image", "meta"]), text: z.string().trim().min(1).max(400), angle: z.string().max(60).default(""), why: z.string().max(400).default(""), issues: z.array(z.string()).default([]), limit: z.number().optional(), data: z.record(z.string(), z.string().max(600)).optional() });
/** add the picked proposals */
export const PUT = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ proposals: z.array(P).min(1).max(60), campaignCode: z.string().max(80).nullable().optional(), assetGroup: z.string().max(80).nullable().optional() }).parse(await req.json());
  return json(await applyProposals(projectId, b.proposals, { campaignCode: b.campaignCode, assetGroup: b.assetGroup }));
});
