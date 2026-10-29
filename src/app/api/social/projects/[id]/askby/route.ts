import fsp from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { isStaff, HttpError } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { makeTempDir, toLocalFile } from "@/lib/server/storage";
import { projectAccess } from "@/lib/server/social/access";
import { ingestOriginal } from "@/lib/server/social/media";

export const runtime = "nodejs";
export const maxDuration = 300;

/** finished AskBy Studio exports (staff only) that can be taken into this project's library */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await projectAccess(id, "content.edit");
  if (!isStaff(a.user.role)) throw new HttpError(403, "Import z AskBy Studio jest dostępny dla zespołu studia.");
  const renders = await prisma.renderJob.findMany({ where: { status: "SUCCEEDED", outputAssetId: { not: null }, kind: { not: "preview" } }, orderBy: { updatedAt: "desc" }, take: 60, select: { id: true, updatedAt: true, compositionId: true, kind: true, project: { select: { name: true } }, composition: { select: { question: { select: { text: true } } } } } });
  const imported = new Set((await prisma.socialMedia.findMany({ where: { projectId: id, importedFrom: { not: null } }, select: { importedFrom: true } })).map((m) => m.importedFrom));
  return json({ renders: renders.map((r) => ({ id: r.id, at: r.updatedAt, project: r.project?.name ?? "", title: r.composition?.question?.text ?? (r.kind === "combined" ? "Wywiad łączony" : "Film"), imported: imported.has(r.id) })) });
});

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await projectAccess(id, "content.edit");
  if (!isStaff(a.user.role)) throw new HttpError(403, "Import z AskBy Studio jest dostępny dla zespołu studia.");
  const b = z.object({ renderJobId: z.string().max(64) }).parse(await req.json());
  const r = await prisma.renderJob.findUniqueOrThrow({ where: { id: b.renderJobId }, select: { id: true, outputAssetId: true, composition: { select: { question: { select: { text: true } } } } } });
  const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: r.outputAssetId! } });
  const title = r.composition?.question?.text ?? "Film z AskBy Studio";
  const m = await prisma.socialMedia.create({ data: { projectId: id, uploadedById: a.user.id, title, originalName: asset.originalName ?? "askby.mp4", storageKey: `pending/${id}/${crypto.randomUUID()}`, status: "PROCESSING", importedFrom: r.id, isDemo: a.project.isDemo } });
  const src = await toLocalFile(asset.storageKey);
  const dir = await makeTempDir("smaskby");
  try {
    const copy = path.join(dir, "film.mp4");
    await fsp.copyFile(src.path, copy);
    await ingestOriginal(m.id, copy);
  } finally {
    await src.cleanup();
    await fsp.rm(dir, { recursive: true, force: true });
  }
  return json({ id: m.id }, 201);
});
