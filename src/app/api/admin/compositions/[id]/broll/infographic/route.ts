import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { enqueue } from "@/lib/server/jobs";
import { higgsfieldConfigured } from "@/lib/server/env";
import type { EditorDocument } from "@/lib/editor/types";

const Body = z.object({
  infographic: z.object({
    headline: z.string().trim().min(1).max(120),
    items: z.array(z.object({ value: z.string().trim().max(40), label: z.string().trim().max(160) })).min(1).max(4),
    note: z.string().trim().max(200).nullable().optional(),
  }),
  /** background illustration in the category style (Higgsfield text-to-image); null = theme background */
  imagePrompt: z.string().trim().max(3000).nullable().optional(),
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
  const imagePrompt = b.imagePrompt && higgsfieldConfigured() ? b.imagePrompt : null;
  const payload = { compositionId: id, infographic: { ...b.infographic, note: b.infographic.note || null }, imagePrompt, width: doc.width, height: doc.height };
  const key = crypto.createHash("sha256").update(JSON.stringify([payload, b.start.toFixed(1)])).digest("hex").slice(0, 40);
  const job = await enqueue("generate-infographic", payload, { idempotencyKey: `infographic:${key}`, maxAttempts: 3 });
  return json({ jobId: job.id, illustrated: !!imagePrompt }, 202);
});
