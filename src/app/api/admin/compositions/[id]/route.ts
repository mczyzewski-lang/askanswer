import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { loadStudio } from "@/lib/server/composition";
import { EditorDocumentSchema } from "@/lib/editor/schema";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  return json(await loadStudio(id));
});

/** Persist the editing decisions. Optimistic concurrency via `version`. */
export const PUT = route(async (req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const body = z.object({ version: z.number().int(), document: EditorDocumentSchema, name: z.string().max(200).optional() }).parse(await req.json());
  const res = await prisma.videoComposition.updateMany({
    where: { id, version: body.version },
    data: {
      document: body.document as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
      status: "EDITED",
      ...(body.name ? { name: body.name } : {}),
    },
  });
  if (res.count === 0) {
    const cur = await prisma.videoComposition.findUnique({ where: { id }, select: { version: true } });
    if (!cur) return json({ error: "Nie znaleziono kompozycji" }, 404);
    return json({ error: "Kompozycja została zmieniona w innym oknie. Odśwież stronę.", version: cur.version }, 409);
  }
  return json({ ok: true, version: body.version + 1, savedAt: new Date().toISOString() });
});

export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  await prisma.videoComposition.delete({ where: { id } });
  return json({ ok: true });
});
