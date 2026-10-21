import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { enqueue } from "@/lib/server/jobs";
import { rateLimit } from "@/lib/server/ratelimit";
import type { EditorDocument } from "@/lib/editor/types";

const RenderBody = z.object({
  format: z.enum(["1080x1920", "720x1280", "1920x1080", "1080x1080"]).default("1080x1920"),
  quality: z.enum(["draft", "standard", "high"]).default("standard"),
  hook: z.number().int().min(0).max(500).nullable().optional(),
  /** Ads Studio: one render per hook version */
  allHooks: z.boolean().optional(),
});

/** Queue a real server-side render of the current saved composition. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireAdmin();
  const { id } = await ctx.params;
  if (!rateLimit(`render:${user.id}`, { capacity: 10, perMinute: 6 })) return json({ error: "Zbyt wiele renderów naraz" }, 429);
  const { allHooks, ...settings } = RenderBody.parse(await req.json().catch(() => ({})));
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id } });
  if (allHooks) {
    const variants = (comp.document as unknown as EditorDocument).hooks?.variants ?? [];
    const jobs = [];
    for (let i = 0; i < variants.length; i++) {
      const j = await prisma.renderJob.create({ data: { projectId: comp.projectId, compositionId: id, kind: "single", settings: { ...settings, hook: i } } });
      await enqueue("render", { renderJobId: j.id }, { idempotencyKey: `render:${j.id}`, maxAttempts: 2 });
      jobs.push({ id: j.id, code: variants[i].code });
    }
    return json({ jobs }, 201);
  }
  const job = await prisma.renderJob.create({ data: { projectId: comp.projectId, compositionId: id, kind: "single", settings } });
  await enqueue("render", { renderJobId: job.id }, { idempotencyKey: `render:${job.id}`, maxAttempts: 2 });
  return json({ id: job.id, status: job.status }, 201);
});
