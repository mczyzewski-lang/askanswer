import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";
import { removeTarget, updatePost } from "@/lib/server/social/posts";
import { zonedToUtc } from "@/lib/social/tz";

const Patch = z.object({
  title: z.string().max(500).optional(),
  description: z.string().max(70_000).optional(),
  hashtags: z.array(z.string().max(120)).max(60).optional(),
  cta: z.string().max(500).optional(),
  firstComment: z.string().max(10_000).optional(),
  coverTimestamp: z.number().min(0).max(36_000).nullable().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  mediaVariantId: z.string().max(64).nullable().optional(),
  /** ISO instant, or "YYYY-MM-DDTHH:mm" in the project's time zone; null = no date */
  scheduledAt: z.string().max(40).nullable().optional(),
});

/** edit a publication — a change after approval withdraws the approval */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("post", id, "content.edit");
  const b = Patch.parse(await req.json());
  const opts = b.options ? Object.fromEntries(Object.entries(b.options).filter(([k]) => !k.startsWith("_"))) : undefined;
  const at = b.scheduledAt === undefined ? undefined : b.scheduledAt === null ? null : /Z|[+-]\d\d:?\d\d$/.test(b.scheduledAt) ? new Date(b.scheduledAt) : zonedToUtc(b.scheduledAt, a.project.timezone);
  if (at && Number.isNaN(at.getTime())) return json({ error: "Nieprawidłowa data" }, 400);
  const p = await updatePost(id, { ...b, options: opts, scheduledAt: at }, a.user.id);
  return json({ id: p.id, status: p.status, revision: p.revision });
});

/** remove this target account from the film (its order is cancelled first) */
export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("post", id, "content.edit");
  await removeTarget(id, a.user.id);
  return json({ ok: true });
});
