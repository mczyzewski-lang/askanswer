import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

/** Review of a film version: its status and note. */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const b = z.object({ review: z.enum(["TODO", "OK", "FIX"]).optional(), note: z.string().trim().max(2000).nullable().optional() }).parse(await req.json());
  await prisma.sequenceFilm.update({ where: { id }, data: { ...(b.review ? { review: b.review } : {}), ...(b.note !== undefined ? { note: b.note } : {}) } });
  return json({ ok: true });
});

/** Remove a film version (its edit goes with it; the clips stay for the other versions). */
export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const f = await prisma.sequenceFilm.delete({ where: { id } });
  if (f.compositionId) await prisma.videoComposition.deleteMany({ where: { id: f.compositionId } });
  return json({ ok: true });
});
