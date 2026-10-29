import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";
import { regeneratePost, REGENERATE_MODES } from "@/lib/server/social/ai";
import { applyRegenerated } from "@/lib/server/social/content";

export const runtime = "nodejs";
export const maxDuration = 300;

/** "Regeneruj": krócej / sprzedażowo / edukacyjnie / naturalnie / konkrety / inne CTA / tylko hashtagi */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("post", id, "content.edit");
  const b = z.object({ mode: z.enum(Object.keys(REGENERATE_MODES) as [keyof typeof REGENERATE_MODES, ...Array<keyof typeof REGENERATE_MODES>]) }).parse(await req.json());
  const r = await regeneratePost(id, b.mode, a.user.id);
  const p = await applyRegenerated(id, r.post, b.mode, a.user.id);
  return json({ id: p.id, revision: p.revision, generationId: r.generationId });
});
