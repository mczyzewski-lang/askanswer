import { prisma } from "@/lib/server/db";
import { requireUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { postListInclude, postRow, scope } from "@/lib/server/social/lists";

/** history of publications (newest first), with the provider order state */
export const GET = route(async (req: Request) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const { ids } = await scope(user, url);
  const status = url.searchParams.get("status");
  const platform = url.searchParams.get("platform");
  const q = url.searchParams.get("q")?.trim();
  const posts = await prisma.platformPost.findMany({
    where: { projectId: { in: ids }, ...(status ? { status: { in: status.split(",") as never } } : { status: { not: "DRAFT" } }), ...(platform ? { platform: platform as never } : {}), ...(q ? { OR: [{ description: { contains: q, mode: "insensitive" } }, { contentItem: { title: { contains: q, mode: "insensitive" } } }] } : {}) },
    include: { ...postListInclude, publications: { orderBy: { generation: "desc" }, take: 1, select: { status: true, providerJobId: true, providerRequestId: true, externalId: true, errorMessage: true } } },
    orderBy: [{ updatedAt: "desc" }],
    take: 300,
  });
  return json({ posts: await Promise.all(posts.map(async (p) => ({ ...(await postRow(p)), provider: p.publications[0] ?? null }))) });
});
