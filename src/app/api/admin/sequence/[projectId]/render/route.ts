import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";

/** Export the films (all, or the chosen ones) as 1:1 MP4s: one render per film version. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ filmIds: z.array(z.string().max(64)).max(200).optional(), kind: z.enum(["sequence", "testimonial"]).default("sequence"), quality: z.enum(["draft", "standard", "high"]).default("standard") }).parse(await req.json().catch(() => ({})));
  const films = (await prisma.sequenceFilm.findMany({ where: { projectId, kind: b.kind, ...(b.filmIds?.length ? { id: { in: b.filmIds } } : {}) }, orderBy: [{ order: "asc" }] })).filter((f) => f.compositionId);
  const jobs = [];
  for (const f of films) {
    if (!(await prisma.videoComposition.findUnique({ where: { id: f.compositionId! }, select: { id: true } }))) continue;
    const j = await prisma.renderJob.create({ data: { projectId, compositionId: f.compositionId, kind: "single", settings: { format: "1080x1080", quality: b.quality } } });
    await enqueue("render", { renderJobId: j.id }, { idempotencyKey: `render:${j.id}`, maxAttempts: 2 });
    jobs.push({ id: j.id, filmId: f.id, code: `${f.code}${f.version}` });
  }
  if (!jobs.length) return json({ error: "Nie ma jeszcze filmów do eksportu - wgraj paczkę." }, 409);
  return json({ jobs }, 201);
});
