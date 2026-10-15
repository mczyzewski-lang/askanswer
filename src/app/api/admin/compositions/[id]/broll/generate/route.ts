import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { enqueue } from "@/lib/server/jobs";
import { higgsfieldConfigured } from "@/lib/server/env";
import { videoModel } from "@/lib/server/higgsfield";

const Body = z.object({
  prompt: z.string().trim().min(5).max(2500),
  duration: z.number().int().min(3).max(15),
  model: z.string().max(120).optional(),
  aspect: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
  /** where the clip will be placed — part of the idempotency key so a double click never pays twice */
  start: z.number().min(0).max(3600),
});

/** Queue a Higgsfield text-to-video generation; the client polls /api/admin/jobs/[jobId]. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireAdmin();
  const { id } = await ctx.params;
  if (!higgsfieldConfigured()) return json({ error: "Higgsfield nie jest skonfigurowany — dodaj HIGGSFIELD_CREDENTIALS (KEY_ID:KEY_SECRET) w zmiennych środowiska." }, 503);
  const b = Body.parse(await req.json());
  await prisma.videoComposition.findUniqueOrThrow({ where: { id }, select: { id: true } });
  const model = videoModel(b.model);
  const duration = model.durations.reduce((best, d) => (Math.abs(d - b.duration) < Math.abs(best - b.duration) ? d : best), model.durations[0]);
  if (!rateLimit(`broll:${user.id}`, { capacity: 8, perMinute: 4 })) return json({ error: "Zbyt wiele generowań naraz — spróbuj za chwilę." }, 429);
  const key = crypto.createHash("sha256").update([id, b.prompt, model.id, duration, b.aspect, b.start.toFixed(1)].join("|")).digest("hex").slice(0, 40);
  const job = await enqueue("generate-broll", { compositionId: id, prompt: b.prompt, duration, model: model.id, aspect: b.aspect }, { idempotencyKey: `broll:${key}`, maxAttempts: 3 });
  return json({ jobId: job.id, duration, model: model.id }, 202);
});
