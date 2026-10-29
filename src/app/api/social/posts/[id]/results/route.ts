import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { accessVia } from "@/lib/server/social/access";

/** the latest numbers of one publication and its views curve */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await accessVia("post", id, "analytics.view");
  const snaps = await prisma.analyticsSnapshot.findMany({ where: { platformPostId: id }, orderBy: { capturedAt: "asc" } });
  const l = snaps[snaps.length - 1];
  return json({
    latest: l ? { capturedAt: l.capturedAt.toISOString(), checkpoint: l.checkpoint, views: l.views, reach: l.reach, impressions: l.impressions, likes: l.likes, comments: l.comments, shares: l.shares, saves: l.saves, watchTimeSec: l.watchTimeSec, avgViewDurationSec: l.avgViewDurationSec, engagementRate: l.engagementRate, unsupported: l.unsupported } : null,
    curve: snaps.map((s) => ({ at: s.capturedAt.toISOString(), checkpoint: s.checkpoint, views: s.views })),
  });
});
