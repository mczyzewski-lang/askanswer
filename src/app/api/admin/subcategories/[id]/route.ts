import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(await req.json());
  return json(await prisma.subcategory.update({ where: { id }, data: { name } }));
});

/** Deleting a subcategory keeps its questions (they just lose the subcategory). */
export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  await prisma.subcategory.delete({ where: { id } });
  return json({ ok: true });
});
