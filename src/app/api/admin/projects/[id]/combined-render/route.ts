import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";

/** Combine selected question-answer videos into one longer interview (rendered then concatenated). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id: projectId } = await ctx.params;
  const body = z
    .object({
      compositionIds: z.array(z.string()).min(2).max(50),
      format: z.enum(["1080x1920", "720x1280", "1920x1080", "1080x1080"]).default("1080x1920"),
      quality: z.enum(["draft", "standard", "high"]).default("standard"),
    })
    .parse(await req.json());
  const count = await prisma.videoComposition.count({ where: { id: { in: body.compositionIds }, projectId } });
  if (count !== body.compositionIds.length) return json({ error: "Wybrane filmy muszą należeć do tego projektu" }, 400);
  const job = await prisma.renderJob.create({
    data: { projectId, kind: "combined", compositionIds: body.compositionIds, settings: { format: body.format, quality: body.quality } },
  });
  await enqueue("render", { renderJobId: job.id }, { idempotencyKey: `render:${job.id}`, maxAttempts: 2 });
  return json({ id: job.id }, 201);
});
