import { prisma } from "@/lib/server/db";
import { requireUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { signedUrl } from "@/lib/server/storage";
import { postListInclude, postRow, scope } from "@/lib/server/social/lists";
import { readiness, loadPost } from "@/lib/server/social/posts";

/** the approval queue: everything waiting for a decision, with what the approver needs to see */
export const GET = route(async (req: Request) => {
  const user = await requireUser();
  const { ids, projects } = await scope(user, new URL(req.url));
  const posts = await prisma.platformPost.findMany({ where: { projectId: { in: ids }, status: "PENDING_APPROVAL" }, include: { ...postListInclude, contentItem: { select: { id: true, title: true, media: { select: { title: true, thumbnailKey: true, durationSec: true, storageKey: true, mimeType: true } } } } }, orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }], take: 200 });
  const rows = await Promise.all(
    posts.map(async (p) => ({
      ...(await postRow(p)),
      videoUrl: await signedUrl(p.contentItem.media.storageKey, { ttlSec: 3600, mime: p.contentItem.media.mimeType }),
      issues: (await readiness(await loadPost(p.id))).filter((i) => i.level === "error").map((i) => i.message),
      canApprove: projects.find((x) => x.id === p.projectId)?.roles.some((r) => ["OWNER", "ADMIN", "APPROVER"].includes(r)) ?? false,
    })),
  );
  return json({ posts: rows });
});
