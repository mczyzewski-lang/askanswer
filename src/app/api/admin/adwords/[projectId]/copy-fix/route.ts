import { z } from "zod";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { copyFixes, setTopic } from "@/lib/server/adwords-copy";

export const maxDuration = 120;

/** proposals: headlines that do not name the topic, rewritten (nothing is saved here) */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  return json(await copyFixes(projectId));
});

/** the topic of the ads ("rozwód"); empty = read it from the texts */
export const PUT = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const { topic } = z.object({ topic: z.string().max(120).nullable() }).parse(await req.json());
  await setTopic(projectId, topic);
  return json({ ok: true });
});
