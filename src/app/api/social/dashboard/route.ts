import { prisma } from "@/lib/server/db";
import { requireUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { postListInclude, postRow, scope } from "@/lib/server/social/lists";

/** what needs attention now, across the projects I can see (or the picked one) */
export const GET = route(async (req: Request) => {
  const user = await requireUser();
  const { ids } = await scope(user, new URL(req.url));
  const now = new Date();
  const [counts, upcoming, failed, reauth, unread, leads, recent] = await Promise.all([
    prisma.platformPost.groupBy({ by: ["status"], where: { projectId: { in: ids } }, _count: true }),
    prisma.platformPost.findMany({ where: { projectId: { in: ids }, status: { in: ["SCHEDULED", "SCHEDULING", "APPROVED", "PENDING_APPROVAL"] }, scheduledAt: { gte: now, lt: new Date(now.getTime() + 7 * 86400e3) } }, include: postListInclude, orderBy: { scheduledAt: "asc" }, take: 12 }),
    prisma.platformPost.findMany({ where: { projectId: { in: ids }, status: { in: ["SCHEDULING_FAILED", "PUBLISH_FAILED", "REAUTH_REQUIRED"] } }, include: postListInclude, orderBy: { updatedAt: "desc" }, take: 8 }),
    prisma.socialAccount.findMany({ where: { projectId: { in: ids }, connectionStatus: { in: ["REAUTH_REQUIRED", "DISCONNECTED"] }, posts: { some: {} } }, select: { id: true, platform: true, displayName: true, accountHandle: true, connectionStatus: true, projectId: true, project: { select: { name: true } } } }),
    prisma.socialComment.count({ where: { projectId: { in: ids }, isOwn: false, readAt: null, status: { in: ["NEW", "NEEDS_REPLY", "ESCALATED"] } } }),
    prisma.socialComment.count({ where: { projectId: { in: ids }, isLead: true, status: { in: ["NEW", "NEEDS_REPLY", "ESCALATED"] } } }),
    prisma.platformPost.findMany({ where: { projectId: { in: ids }, status: "PUBLISHED", publishedAt: { gte: new Date(now.getTime() - 7 * 86400e3) } }, include: { ...postListInclude, snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } }, orderBy: { publishedAt: "desc" }, take: 10 }),
  ]);
  const c = (s: string[]) => counts.filter((x) => s.includes(x.status)).reduce((n, x) => n + x._count, 0);
  return json({
    counts: { pending: c(["PENDING_APPROVAL"]), scheduled: c(["SCHEDULED", "SCHEDULING", "APPROVED"]), published: c(["PUBLISHED"]), failed: c(["SCHEDULING_FAILED", "PUBLISH_FAILED", "REAUTH_REQUIRED"]), drafts: c(["DRAFT", "CHANGES_REQUESTED"]), unreadComments: unread, leads },
    upcoming: await Promise.all(upcoming.map(postRow)),
    failed: await Promise.all(failed.map(postRow)),
    reauth,
    recent: await Promise.all(recent.map(async (p) => ({ ...(await postRow(p)), metrics: p.snapshots[0] ? { views: p.snapshots[0].views, likes: p.snapshots[0].likes, comments: p.snapshots[0].comments, capturedAt: p.snapshots[0].capturedAt } : null }))),
  });
});
