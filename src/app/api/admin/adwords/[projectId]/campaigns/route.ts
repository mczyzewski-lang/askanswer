import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ code: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(160), goal: z.enum(["sprzedaz", "poradnik"]).default("sprzedaz"), landingUrl: z.string().url().max(500).nullable().optional() }).parse(await req.json());
  const c = await prisma.adwordsCampaign.create({ data: { projectId, ...b } });
  return json(c, 201);
});
