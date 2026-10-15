import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id: categoryId } = await ctx.params;
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(await req.json());
  const n = await prisma.subcategory.count({ where: { categoryId } });
  return json(await prisma.subcategory.upsert({ where: { categoryId_name: { categoryId, name } }, create: { categoryId, name, order: n }, update: {} }), 201);
});
