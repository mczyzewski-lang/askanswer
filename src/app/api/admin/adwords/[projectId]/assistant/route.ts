import { z } from "zod";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { applyDraft, assistantDraft, type AssistantDraft } from "@/lib/server/adwords-assistant";

/** Draft a creative from the person's description (nothing saved). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  const me = await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ prompt: z.string().trim().min(5).max(3000), kind: z.enum(["image", "video"]).default("image") }).parse(await req.json());
  if (!rateLimit(`adw-assistant:${me.id}`, { capacity: 20, perMinute: 10 })) return json({ error: "Zbyt wiele zapytań — spróbuj za chwilę." }, 429);
  return json(await assistantDraft(projectId, b.prompt, b.kind));
});

const Scene = z.object({ startS: z.number().min(0).max(3600), endS: z.number().min(0).max(3600), spokenText: z.string().max(3000), screenText: z.string().max(300), visualBrief: z.string().max(1000) });
const Draft = z.object({
  kind: z.enum(["image", "video"]),
  conceptId: z.string().trim().regex(/^[\w-]{1,20}$/, "Kod konceptu: litery, cyfry, - _"),
  rationale: z.string().max(1000).default(""),
  image: z.object({ layout: z.enum(["typographic", "expert_split", "process_steps"]), headline: z.string().min(1).max(200), subheadline: z.string().max(300), body: z.string().max(600), cta: z.string().max(80), visualBrief: z.string().max(1000), useExpertPhoto: z.boolean() }).optional(),
  video: z.object({ durationSec: z.number().min(1).max(600), scenes: z.array(Scene).min(1).max(20) }).optional(),
  headlineForAds: z.string().max(30).nullable().optional(),
  claimSource: z.string().max(500).nullable().optional(),
  engine: z.enum(["openai", "template"]).default("openai"),
});

/** Save the accepted (and possibly edited) draft as components. */
export const PUT = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ draft: Draft, campaignCode: z.string().max(80).nullable().optional(), assetGroup: z.string().max(80).nullable().optional(), expertPhotoId: z.string().max(64).nullable().optional(), headlineForAds: z.boolean().optional() }).parse(await req.json());
  try {
    return json(await applyDraft(projectId, b.draft as AssistantDraft, b), 201);
  } catch (e) {
    return json({ error: (e as Error).message }, 409);
  }
});
