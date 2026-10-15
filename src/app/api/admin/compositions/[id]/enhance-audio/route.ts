import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { cachedEnhancement } from "@/lib/server/enhance";
import { assetInfo } from "@/lib/server/assets";
import { elevenLabsConfigured } from "@/lib/server/env";
import { enqueue } from "@/lib/server/jobs";
import { rateLimit } from "@/lib/server/ratelimit";
import type { EditorDocument } from "@/lib/editor/types";

/**
 * Enhance the expert's voice. Cached versions are returned immediately; otherwise a
 * background job is queued (ElevenLabs + FFmpeg can take a while — never tied to one
 * HTTP request) and the client polls /api/admin/jobs/[id].
 */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireAdmin();
  const { id } = await ctx.params;
  const { mode, strength } = z.object({ mode: z.enum(["podcast", "isolator"]), strength: z.enum(["natural", "podcast", "radio"]).default("podcast") }).parse(await req.json());
  if (mode === "isolator" && !elevenLabsConfigured()) return json({ error: "Voice Isolator wymaga konfiguracji ElevenLabs (ELEVENLABS_API_KEY)." }, 503);
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id } });
  const doc = comp.document as unknown as EditorDocument;
  const sources = [...new Set(doc.clips.map((c) => c.assetId))];
  const map: Record<string, string> = {};
  for (const s of sources) {
    const c = await cachedEnhancement(s, mode, strength);
    if (!c) {
      if (!rateLimit(`enhance:${user.id}`, { capacity: 6, perMinute: 6 })) return json({ error: "Zbyt wiele żądań — spróbuj za chwilę." }, 429);
      const job = await enqueue("enhance-audio", { compositionId: id, mode, strength }, { idempotencyKey: `enhance:${id}:${mode}:${strength}:${Math.floor(Date.now() / 60_000)}`, maxAttempts: 2 });
      return json({ jobId: job.id }, 202);
    }
    map[s] = c;
  }
  const assets = (await Promise.all(Object.values(map).map((a) => assetInfo(a)))).filter(Boolean);
  return json({ map, assets });
});
