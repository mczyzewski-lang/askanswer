import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { projectAccess } from "@/lib/server/social/access";
import { decide } from "@/lib/server/social/posts";

/** Akceptuj / Odrzuć / Poproś o poprawki — for the exact revisions the approver saw */
export const POST = route(async (req: Request) => {
  const b = z.object({ items: z.array(z.object({ postId: z.string().max(64), revision: z.number().int().min(1) })).min(1).max(50), decision: z.enum(["APPROVED", "REJECTED", "CHANGES_REQUESTED"]), comment: z.string().max(4000).default("") }).parse(await req.json());
  const posts = await prisma.platformPost.findMany({ where: { id: { in: b.items.map((i) => i.postId) } }, select: { id: true, projectId: true } });
  if (posts.length !== b.items.length) return json({ error: "Nie znaleziono publikacji" }, 404);
  let userId = "";
  for (const pid of new Set(posts.map((p) => p.projectId))) userId = (await projectAccess(pid, "content.approve")).user.id;
  return json({ results: await decide(b.items, b.decision, b.comment, userId) });
});
