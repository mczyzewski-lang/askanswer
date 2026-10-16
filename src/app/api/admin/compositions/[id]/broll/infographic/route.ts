import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { enqueue } from "@/lib/server/jobs";
import { higgsfieldConfigured, openaiConfigured } from "@/lib/server/env";
import type { EditorDocument } from "@/lib/editor/types";

const Info = z.object({
  headline: z.string().trim().min(1).max(120),
  items: z.array(z.object({ value: z.string().trim().max(40), label: z.string().trim().max(160) })).min(1).max(4),
  note: z.string().trim().max(200).nullable().optional(),
});
const Body = z.object({
  /** required for infographics; illustrations have no text */
  infographic: Info.optional(),
  /** background illustration in the category style (Higgsfield text-to-image); null = theme background */
  imagePrompt: z.string().trim().max(3000).nullable().optional(),
  illustration: z.enum(["none", "higgsfield", "openai"]).default("higgsfield"),
  /** "openai" = the whole infographic (with its text) is drawn by OpenAI */
  engine: z.enum(["template", "openai", "illustration"]).default("template"),
  /** illustration: the passage of the answer it expresses and a short layer name */
  passage: z.string().trim().max(4000).nullable().optional(),
  title: z.string().trim().max(120).nullable().optional(),
  start: z.number().min(0).max(3600),
});

/** Queue an infographic image (rendered in the theme's fonts and colours); the client polls /api/admin/jobs/[jobId]. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireAdmin();
  const { id } = await ctx.params;
  const b = Body.parse(await req.json());
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id }, select: { document: true } });
  const doc = comp.document as unknown as EditorDocument;
  if (!rateLimit(`infographic:${user.id}`, { capacity: 10, perMinute: 6 })) return json({ error: "Zbyt wiele żądań — spróbuj za chwilę." }, 429);
  if (b.engine === "openai" && !openaiConfigured()) return json({ error: "Grafika z OpenAI wymaga klucza OPENAI_API_KEY w Railway → Variables." }, 503);
  if (b.engine === "illustration") {
    if (!openaiConfigured() && !higgsfieldConfigured()) return json({ error: "Ilustracje wymagają klucza OPENAI_API_KEY w Railway → Variables." }, 503);
    if (!b.imagePrompt && !b.passage) return json({ error: "Opisz, co ma przedstawiać ilustracja." }, 400);
    const title = b.title || "Ilustracja";
    const payload = { compositionId: id, engine: "illustration", infographic: { headline: title, items: [], note: null }, imagePrompt: b.imagePrompt ?? "", passage: b.passage ?? "", title, width: doc.width, height: doc.height };
    const key = crypto.createHash("sha256").update(JSON.stringify([payload, b.start.toFixed(1)])).digest("hex").slice(0, 40);
    const job = await enqueue("generate-infographic", payload, { idempotencyKey: `infographic:${key}`, maxAttempts: 3 });
    return json({ jobId: job.id, illustrated: true }, 202);
  }
  if (!b.infographic) return json({ error: "Brak treści infografiki." }, 400);
  const illustration = b.illustration === "openai" ? (openaiConfigured() ? "openai" : "none") : b.illustration === "higgsfield" ? (higgsfieldConfigured() ? "higgsfield" : "none") : "none";
  const imagePrompt = b.imagePrompt && illustration !== "none" ? b.imagePrompt : null;
  const payload = { compositionId: id, infographic: { ...b.infographic, note: b.infographic.note || null }, imagePrompt, illustration, engine: b.engine, width: doc.width, height: doc.height };
  const key = crypto.createHash("sha256").update(JSON.stringify([payload, b.start.toFixed(1)])).digest("hex").slice(0, 40);
  const job = await enqueue("generate-infographic", payload, { idempotencyKey: `infographic:${key}`, maxAttempts: 3 });
  return json({ jobId: job.id, illustrated: !!imagePrompt }, 202);
});
