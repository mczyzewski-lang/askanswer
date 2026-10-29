import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { requireUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { scope, thumb } from "@/lib/server/social/lists";
import { commentsAvailable } from "@/lib/server/social/comments";

/** the unified inbox — filters: project, platform, unanswered, needs reaction, questions, leads, negative */
export const GET = route(async (req: Request) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const { ids, projects } = await scope(user, url, "comments.view");
  const f = url.searchParams.get("filter") ?? "all";
  const platform = url.searchParams.get("platform");
  const where: Prisma.SocialCommentWhereInput = { projectId: { in: ids }, isOwn: false, ...(platform ? { platform: platform as never } : {}) };
  if (f === "unanswered") where.status = { in: ["NEW", "NEEDS_REPLY"] };
  if (f === "attention") where.status = { in: ["NEEDS_REPLY", "ESCALATED"] };
  if (f === "questions") where.isQuestion = true;
  if (f === "leads") where.isLead = true;
  if (f === "negative") where.sentiment = "negative";
  const rows = await prisma.socialComment.findMany({
    where,
    include: { socialAccount: { select: { id: true, displayName: true, accountHandle: true, platform: true, capabilities: true, isDemo: true } }, platformPost: { select: { id: true, contentItemId: true, publishedUrl: true, description: true, contentItem: { select: { title: true, media: { select: { title: true, thumbnailKey: true } } } } } }, replies: { orderBy: { createdAt: "desc" } } },
    orderBy: { postedAt: "desc" },
    take: 200,
  });
  const threads = await prisma.socialComment.findMany({ where: { projectId: { in: ids }, parentNativeId: { in: rows.map((r) => r.nativeId) } }, orderBy: { postedAt: "asc" }, select: { parentNativeId: true, socialAccountId: true, text: true, isOwn: true, authorName: true, postedAt: true } });
  const accounts = await prisma.socialAccount.findMany({ where: { projectId: { in: ids }, connectionStatus: { not: "DISCONNECTED" } }, select: { id: true, platform: true, displayName: true, capabilities: true, projectId: true } });
  return json({
    comments: await Promise.all(
      rows.map(async (c) => ({
        id: c.id,
        projectId: c.projectId,
        project: projects.find((p) => p.id === c.projectId)?.name ?? "",
        canReply: projects.find((p) => p.id === c.projectId)?.roles.some((r) => ["OWNER", "ADMIN", "EDITOR"].includes(r)) ?? false,
        platform: c.platform,
        account: c.socialAccount.displayName ?? c.socialAccount.accountHandle,
        author: c.authorName || c.authorHandle || "—",
        text: c.text,
        postedAt: c.postedAt.toISOString(),
        status: c.status,
        category: c.category,
        sentiment: c.sentiment,
        isQuestion: c.isQuestion,
        isLead: c.isLead,
        needsHuman: c.needsHuman,
        aiReason: c.aiReason,
        readAt: c.readAt?.toISOString() ?? null,
        isDemo: c.isDemo,
        post: c.platformPost && { id: c.platformPost.id, contentItemId: c.platformPost.contentItemId, url: c.platformPost.publishedUrl, title: c.platformPost.contentItem.title || c.platformPost.contentItem.media.title, thumbUrl: await thumb(c.platformPost.contentItem.media.thumbnailKey) },
        thread: threads.filter((t) => t.parentNativeId === c.nativeId && t.socialAccountId === c.socialAccountId).map((t) => ({ text: t.text, isOwn: t.isOwn, author: t.authorName, at: t.postedAt.toISOString() })),
        replies: c.replies.map((r) => ({ id: r.id, text: r.text, source: r.source, status: r.status, visibility: r.visibility, error: r.error, sentAt: r.sentAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() })),
      })),
    ),
    unavailable: accounts.filter((a) => !commentsAvailable(a)).map((a) => ({ id: a.id, platform: a.platform, name: a.displayName, projectId: a.projectId })),
  });
});
