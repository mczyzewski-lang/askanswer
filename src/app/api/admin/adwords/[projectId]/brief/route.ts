import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

/** The agency brief as edited by hand (null = the generated one). */
export const PUT = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const { text } = z.object({ text: z.string().max(40_000).nullable() }).parse(await req.json());
  await prisma.project.update({ where: { id: projectId }, data: { adwordsBrief: text?.trim() ? text : null } });
  return json({ ok: true });
});
