import { json, route } from "@/lib/server/http";
import { accessVia, aiLimit } from "@/lib/server/social/access";
import { alternativeOpenings } from "@/lib/server/social/ai";

export const runtime = "nodejs";
export const maxDuration = 300;

/** 3 alternative openings (shown to choose from — nothing is changed until one is used) */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("post", id, "content.edit");
  aiLimit(a.user.id);
  return json({ openings: await alternativeOpenings(id, a.user.id) });
});
