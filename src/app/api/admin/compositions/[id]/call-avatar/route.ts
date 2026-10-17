import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";
import { rateLimit } from "@/lib/server/ratelimit";
import { openaiConfigured, openaiKeyDiagnostics } from "@/lib/server/env";

/** Question as a phone call: a natural "selfie" of the caller from OpenAI (variants); the client polls the job. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireAdmin();
  const { id } = await ctx.params;
  const b = z.object({ gender: z.enum(["female", "male"]), name: z.string().trim().min(1).max(60) }).parse(await req.json());
  if (!openaiConfigured()) return json({ error: `Zdjęcie rozmówcy wymaga klucza OpenAI. ${openaiKeyDiagnostics()}` }, 503);
  if (!rateLimit(`avatar:${user.id}`, { capacity: 6, perMinute: 3 })) return json({ error: "Zbyt wiele żądań — spróbuj za chwilę." }, 429);
  await prisma.videoComposition.findUniqueOrThrow({ where: { id }, select: { id: true } });
  const job = await enqueue("generate-avatar", { compositionId: id, gender: b.gender, name: b.name }, { maxAttempts: 2 });
  return json({ jobId: job.id }, 202);
});
