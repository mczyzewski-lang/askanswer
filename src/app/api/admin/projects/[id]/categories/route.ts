import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(await req.json());
  const count = await prisma.category.count({ where: { projectId: id } });
  const cat = await prisma.category.upsert({ where: { projectId_name: { projectId: id, name } }, create: { projectId: id, name, order: count }, update: {} });
  return json(cat, 201);
});
