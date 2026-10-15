import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enhanceAudio } from "@/lib/server/enhance";
import { assetInfo } from "@/lib/server/assets";
import { elevenLabsConfigured } from "@/lib/server/env";
import { ElevenLabsError } from "@/lib/server/elevenlabs";
import { rateLimit } from "@/lib/server/ratelimit";
import type { EditorDocument } from "@/lib/editor/types";

export const runtime = "nodejs";
export const maxDuration = 600;

/** Create (or reuse) an enhanced version of the expert's voice for every recording used in this composition. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireAdmin();
  const { id } = await ctx.params;
  const { mode, strength } = z.object({ mode: z.enum(["podcast", "isolator"]), strength: z.enum(["natural", "podcast", "radio"]).default("podcast") }).parse(await req.json());
  if (mode === "isolator" && !elevenLabsConfigured()) return json({ error: "Voice Isolator wymaga konfiguracji ElevenLabs (ELEVENLABS_API_KEY)." }, 503);
  if (!rateLimit(`enhance:${user.id}`, { capacity: 6, perMinute: 6 })) return json({ error: "Zbyt wiele żądań — spróbuj za chwilę." }, 429);
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id } });
  const doc = comp.document as unknown as EditorDocument;
  const sources = [...new Set(doc.clips.map((c) => c.assetId))];
  try {
    const map: Record<string, string> = {};
    for (const s of sources) map[s] = await enhanceAudio(s, mode, strength);
    const assets = (await Promise.all(Object.values(map).map((a) => assetInfo(a)))).filter(Boolean);
    return json({ map, assets });
  } catch (e) {
    if (e instanceof ElevenLabsError) return json({ error: e.message }, 502);
    throw e;
  }
});
