import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

/** add a claim to the registry by hand */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ claimText: z.string().trim().min(2).max(500), claimScope: z.string().max(500).optional() }).parse(await req.json());
  const key = `manual_${b.claimText.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").slice(0, 50)}`;
  const c = await prisma.adwordsClaim.upsert({ where: { projectId_key: { projectId, key } }, create: { projectId, key, claimText: b.claimText, claimScope: b.claimScope ?? null }, update: {} });
  return json(c, 201);
});
