import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { elevenLabsConfigured } from "@/lib/server/env";
import { accessVia } from "@/lib/server/social/access";
import { enqueueSocial } from "@/lib/server/social/queue";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("media", id, "content.edit");
  if (!elevenLabsConfigured()) return json({ error: "Transkrypcja wymaga klucza ElevenLabs (ELEVENLABS_API_KEY)." }, 503);
  await prisma.socialMedia.update({ where: { id }, data: { transcriptStatus: "Zaplanowana" } });
  const job = await enqueueSocial("social-transcribe", { mediaId: id, projectId: a.project.id }, { idempotencyKey: `transcribe:${id}:${Date.now()}`, maxAttempts: 2 });
  return json({ jobId: job.id }, 202);
});
