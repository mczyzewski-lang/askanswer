import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { openaiConfigured } from "@/lib/server/env";
import { accessVia } from "@/lib/server/social/access";
import { enqueueSocial } from "@/lib/server/social/queue";

/** "Przygotuj publikacje z AI" (all targets, or chosen ones) — runs in the background */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("content", id, "content.edit");
  if (!openaiConfigured()) return json({ error: "Funkcje AI wymagają klucza OpenAI (OPENAI_API_KEY)." }, 503);
  const b = z.object({ postIds: z.array(z.string().max(64)).max(20).optional() }).parse(await req.json().catch(() => ({})));
  const job = await enqueueSocial("social-generate", { contentItemId: id, projectId: a.project.id, userId: a.user.id, postIds: b.postIds }, { idempotencyKey: `generate:${id}:${Date.now()}`, maxAttempts: 2 });
  return json({ jobId: job.id }, 202);
});
