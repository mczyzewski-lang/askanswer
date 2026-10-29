import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { projectAccess } from "@/lib/server/social/access";
import { submitForApproval } from "@/lib/server/social/posts";

/** "Wyślij do akceptacji" */
export const POST = route(async (req: Request) => {
  const b = z.object({ postIds: z.array(z.string().max(64)).min(1).max(50) }).parse(await req.json());
  const posts = await prisma.platformPost.findMany({ where: { id: { in: b.postIds } }, select: { id: true, projectId: true } });
  let userId = "";
  for (const pid of new Set(posts.map((p) => p.projectId))) userId = (await projectAccess(pid, "content.edit")).user.id;
  if (!posts.length) return json({ error: "Nie znaleziono publikacji" }, 404);
  return json({ results: await submitForApproval(posts.map((p) => p.id), userId) });
});
