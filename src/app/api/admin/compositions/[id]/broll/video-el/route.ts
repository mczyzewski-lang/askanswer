import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { elevenLabsConfigured } from "@/lib/server/env";
import { json, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { enqueue } from "@/lib/server/jobs";
import { EL_VIDEO_MODELS } from "@/lib/server/eleven-video";

const Body = z.object({
  prompt: z.string().trim().min(10).max(2500),
  duration: z.number().int().min(2).max(15).default(8),
  model: z.enum(EL_VIDEO_MODELS.map((m) => m.id) as [string, ...string[]]).default(EL_VIDEO_MODELS[0].id),
  aspect: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
  /** where the clip goes — in the idempotency key, so a double click never pays twice */
  start: z.number().min(0).max(36000),
});

/** Queue an ElevenLabs (Veo) text-to-video clip; the Studio polls /api/admin/jobs/[jobId] and places it. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireAdmin();
  const { id } = await ctx.params;
  if (!elevenLabsConfigured()) return json({ error: "ElevenLabs nie jest skonfigurowany — dodaj ELEVENLABS_API_KEY w zmiennych środowiska." }, 503);
  const b = Body.parse(await req.json());
  await prisma.videoComposition.findUniqueOrThrow({ where: { id }, select: { id: true } });
  const model = EL_VIDEO_MODELS.find((m) => m.id === b.model)!;
  const duration = model.durations.reduce<number>((best, d) => (Math.abs(d - b.duration) < Math.abs(best - b.duration) ? d : best), model.durations[0]);
  if (!rateLimit(`elvideo:${user.id}`, { capacity: 6, perMinute: 3 })) return json({ error: "Zbyt wiele generowań naraz — spróbuj za chwilę." }, 429);
  const key = crypto.createHash("sha256").update([id, b.prompt, model.id, duration, b.aspect, b.start.toFixed(1)].join("|")).digest("hex").slice(0, 40);
  const job = await enqueue("generate-video-el", { compositionId: id, prompt: b.prompt, duration, model: model.id, aspect: b.aspect }, { idempotencyKey: `elvideo:${key}`, maxAttempts: 3 });
  return json({ jobId: job.id, duration, model: model.id }, 202);
});
