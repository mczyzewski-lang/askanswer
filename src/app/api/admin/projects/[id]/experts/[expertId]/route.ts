import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { ensureProjectExpert } from "@/lib/server/project-experts";

type Ctx = { params: Promise<{ id: string; expertId: string }> };

/** Assign the project's questions to this expert: those without an expert (default) or all of them. */
export const POST = route(async (req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id, expertId } = await ctx.params;
  const { scope } = z.object({ scope: z.enum(["unassigned", "all"]).default("unassigned") }).parse(await req.json().catch(() => ({})));
  await prisma.expert.findUniqueOrThrow({ where: { id: expertId } });
  await ensureProjectExpert(id, expertId);
  const r = await prisma.question.updateMany({ where: { projectId: id, ...(scope === "unassigned" ? { expertId: null } : {}) }, data: { expertId } });
  return json({ assigned: r.count });
});

/** Remove the expert from the project; their questions become unassigned (recordings are kept). */
export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id, expertId } = await ctx.params;
  await prisma.$transaction([
    prisma.question.updateMany({ where: { projectId: id, expertId }, data: { expertId: null } }),
    prisma.category.updateMany({ where: { projectId: id, expertId }, data: { expertId: null } }),
    prisma.projectExpert.deleteMany({ where: { projectId: id, expertId } }),
  ]);
  return json({ ok: true });
});
