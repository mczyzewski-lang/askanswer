import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { ingestSequenceImage } from "@/lib/server/sequence";

export const runtime = "nodejs";

/** A cover image of the package (JPG / PNG, a few hundred kB): the manifest links it to its film by the file name. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true } });
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) return json({ error: "Brak pliku" }, 400);
  return json(await ingestSequenceImage(projectId, file), 201);
});
