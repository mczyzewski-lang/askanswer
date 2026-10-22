import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { brollLibrary } from "@/lib/server/broll-library";

/** The project's B-roll library for the Studio (picked ones first). */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id }, select: { projectId: true } });
  const items = await brollLibrary(comp.projectId);
  return json({ items: [...items.filter((i) => i.picked), ...items.filter((i) => !i.picked)] });
});
