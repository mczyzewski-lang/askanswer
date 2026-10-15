import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";
import { elevenLabsConfigured } from "@/lib/server/env";
import { rateLimit } from "@/lib/server/ratelimit";

/** Request (re-)transcription. Normal processing never transcribes the same media twice. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireAdmin();
  const { id } = await ctx.params;
  if (!elevenLabsConfigured()) return json({ error: "Transkrypcja wymaga konfiguracji ElevenLabs (ELEVENLABS_API_KEY)." }, 503);
  if (!rateLimit(`stt:${user.id}`, { capacity: 10, perMinute: 6 })) return json({ error: "Zbyt wiele żądań transkrypcji" }, 429);
  const force = new URL(req.url).searchParams.get("force") === "1";
  await prisma.recordingTake.findUniqueOrThrow({ where: { id } });
  await prisma.recordingTake.update({ where: { id }, data: { transcriptionError: null } });
  const job = await enqueue("transcribe-take", { takeId: id, force }, { idempotencyKey: `transcribe:${id}:${force ? Date.now() : "auto"}`, maxAttempts: 5 });
  return json({ jobId: job.id });
});
