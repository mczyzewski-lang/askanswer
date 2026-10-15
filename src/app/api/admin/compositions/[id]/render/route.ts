import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";
import { rateLimit } from "@/lib/server/ratelimit";

const RenderBody = z.object({
  format: z.enum(["1080x1920", "720x1280", "1920x1080", "1080x1080"]).default("1080x1920"),
  quality: z.enum(["draft", "standard", "high"]).default("standard"),
});

/** Queue a real server-side render of the current saved composition. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireAdmin();
  const { id } = await ctx.params;
  if (!rateLimit(`render:${user.id}`, { capacity: 10, perMinute: 6 })) return json({ error: "Zbyt wiele renderów naraz" }, 429);
  const settings = RenderBody.parse(await req.json().catch(() => ({})));
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id } });
  const job = await prisma.renderJob.create({ data: { projectId: comp.projectId, compositionId: id, kind: "single", settings } });
  await enqueue("render", { renderJobId: job.id }, { idempotencyKey: `render:${job.id}`, maxAttempts: 2 });
  return json({ id: job.id, status: job.status }, 201);
});
