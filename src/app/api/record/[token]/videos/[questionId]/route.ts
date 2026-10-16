import { json, route } from "@/lib/server/http";
import { resolveToken } from "@/lib/server/invitations";
import { expertVideo } from "@/lib/server/expert-videos";

/** The current edit of one of the expert's films (queues a preview render when the edit changed). */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ token: string; questionId: string }> }) => {
  const { token, questionId } = await ctx.params;
  const inv = await resolveToken(token);
  const v = await expertVideo(inv.projectId, inv.expertId, questionId);
  if (!v?.url) return json({ error: "Ten film nie jest jeszcze dostępny." }, 404);
  return json(v);
});
