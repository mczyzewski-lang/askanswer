import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { ensureProjectExpert } from "@/lib/server/project-experts";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const data = z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      // AI scene style for this category; empty = use the theme's default
      brollStyle: z.string().trim().max(4000).nullable().optional().transform((v) => (v === "" ? null : v)),
      expertId: z.string().max(64).nullable().optional(),
    })
    .parse(await req.json());
  if (data.expertId && !(await prisma.expert.findUnique({ where: { id: data.expertId }, select: { id: true } }))) return json({ error: "Nie znaleziono eksperta" }, 404);
  const cat = await prisma.category.update({ where: { id }, data });
  if (data.expertId) await ensureProjectExpert(cat.projectId, data.expertId);
  return json(cat);
});

export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  await prisma.category.delete({ where: { id } });
  return json({ ok: true });
});
