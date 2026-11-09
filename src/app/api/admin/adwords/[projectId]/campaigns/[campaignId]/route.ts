import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

export const PATCH = route(async (req: Request, ctx: { params: Promise<{ projectId: string; campaignId: string }> }) => {
  await requireAdmin();
  const { projectId, campaignId } = await ctx.params;
  const b = z
    .object({
      name: z.string().trim().min(1).max(160).optional(),
      goal: z.enum(["sprzedaz", "poradnik"]).optional(),
      // never invented: empty = to fill in before publishing
      landingUrl: z.string().url("Podaj pełny adres https://…").max(500).nullable().optional().or(z.literal("").transform(() => null)),
      businessName: z.string().trim().max(25, "Nazwa firmy: maks. 25 znaków").nullable().optional(),
      status: z.enum(["draft", "ready", "paused"]).optional(),
    })
    .parse(await req.json());
  await prisma.adwordsCampaign.updateMany({ where: { id: campaignId, projectId }, data: b });
  return json({ ok: true });
});

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ projectId: string; campaignId: string }> }) => {
  await requireAdmin();
  const { projectId, campaignId } = await ctx.params;
  await prisma.adwordsCampaign.deleteMany({ where: { id: campaignId, projectId } });
  return json({ ok: true });
});
