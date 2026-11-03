import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { assetInfo } from "./assets";

/** B-roll library of a project (Ads Studio): uploaded cutaways, some picked for the Studio. */
export async function brollLibrary(projectId: string) {
  const rows = await prisma.mediaAsset.findMany({
    where: { projectId, kind: { in: ["OVERLAY_VIDEO", "IMAGE"] }, meta: { path: ["library"], equals: "broll" } },
    orderBy: { createdAt: "asc" },
  });
  const items = await Promise.all(
    rows.map(async (r) => {
      const info = await assetInfo(r.id);
      return info ? { ...info, name: r.originalName ?? "B-roll", picked: !!(r.meta as { picked?: boolean } | null)?.picked, isVideo: r.kind === "OVERLAY_VIDEO" } : null;
    }),
  );
  return items.filter((x): x is NonNullable<typeof x> => !!x);
}

export async function setPicked(assetId: string, picked: boolean) {
  const a = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
  const meta = (a.meta ?? {}) as Record<string, unknown>;
  if (meta.library !== "broll") throw new Error("To nie jest plik z biblioteki B-roll");
  await prisma.mediaAsset.update({ where: { id: assetId }, data: { meta: { ...meta, picked } as Prisma.InputJsonValue } });
}

/** B-roll sent in slices: assemble, check it is a video, convert (H.264 + preview) into the library. */
export async function ingestBrollUpload(sessionId: string, totalChunks: number) {
  const { assembleChunks, readHead, sniffVideo } = await import("./chunked");
  const { ingestOverlayVideo } = await import("./uploads");
  const { probe } = await import("./ffmpeg");
  const { diskFullMessage } = await import("./storage");
  const fsp = await import("node:fs/promises");
  const s = await prisma.uploadSession.findUniqueOrThrow({ where: { id: sessionId } });
  if (s.status === "DONE") return { assetId: s.assetId };
  const fail = async (error: string) => {
    await prisma.uploadSession.update({ where: { id: sessionId }, data: { status: "FAILED", error } });
    return { failed: error };
  };
  let dir: string | null = null;
  try {
    const a = await assembleChunks("uploads", sessionId, totalChunks);
    dir = a.dir;
    const { head } = await readHead(a.file);
    const kind = sniffVideo(head);
    if (!kind) return await fail("To nie jest plik wideo (MP4 / MOV / WEBM)");
    const src = `${a.file}.${kind.ext}`;
    await fsp.rename(a.file, src);
    const info = await probe(src).catch(() => null);
    if (!info?.hasVideo) return await fail("Plik wideo jest uszkodzony lub ma nieprawidłowy format");
    if (info.duration > BROLL_MAX_SECONDS) return await fail(`Przebitka może mieć maksymalnie ${BROLL_MAX_SECONDS / 60} min (ten plik: ${Math.round(info.duration / 60)} min) — przytnij ją przed wgraniem.`);
    const asset = await ingestOverlayVideo(src, a.dir, s.projectId, s.name, { library: "broll" });
    await prisma.uploadSession.update({ where: { id: sessionId }, data: { status: "DONE", assetId: asset.id, error: null } });
    return { assetId: asset.id };
  } catch (e) {
    return await fail(diskFullMessage(e) ?? `Nie udało się przetworzyć pliku: ${(e as Error).message.slice(0, 300)}`);
  } finally {
    await fsp.rm(dir ?? (await import("./chunked")).chunkDir("uploads", sessionId), { recursive: true, force: true });
  }
}

/** longest cutaway accepted (it is trimmed in the Studio anyway) */
export const BROLL_MAX_SECONDS = 600;

/** Sliced B-roll uploads still on the way (or failed recently), shown under the library. */
export async function brollPending(projectId: string) {
  const rows = await prisma.uploadSession.findMany({
    where: { projectId, purpose: "broll", OR: [{ status: "PROCESSING" }, { status: { in: ["UPLOADING", "FAILED"] }, updatedAt: { gt: new Date(Date.now() - 86400e3) } }] },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, status: r.status, error: r.error, sizeBytes: Number(r.sizeBytes) }));
}
