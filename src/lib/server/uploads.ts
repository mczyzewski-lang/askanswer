import fsp from "node:fs/promises";
import path from "node:path";
import { prisma } from "./db";
import { makeTempDir, putFile } from "./storage";
import { probe } from "./ffmpeg";
import { randomToken } from "./crypto";
import { HttpError } from "./errors";

/** Store an admin upload after validating it by probing the actual content. */
export async function storeUpload(file: File, kind: "MUSIC" | "IMAGE" | "LOGO", ext: string, projectId: string | null) {
  const dir = await makeTempDir("upload");
  try {
    const p = path.join(dir, `f.${ext}`);
    await fsp.writeFile(p, Buffer.from(await file.arrayBuffer()));
    const info = await probe(p).catch(() => null);
    if (!info || (kind === "MUSIC" && !info.hasAudio) || (kind !== "MUSIC" && !info.hasVideo)) throw new HttpError(415, "Plik jest uszkodzony lub ma nieprawidłowy format");
    const key = `projects/${projectId ?? "shared"}/uploads/${randomToken(12)}.${ext}`;
    const size = await putFile(key, p, file.type);
    return prisma.mediaAsset.create({
      data: {
        kind,
        projectId,
        storageKey: key,
        mimeType: file.type,
        sizeBytes: size,
        durationSec: kind === "MUSIC" ? info.duration : null,
        width: info.width,
        height: info.height,
        hasAudio: info.hasAudio,
        hasVideo: kind !== "MUSIC",
        originalName: file.name.slice(0, 120),
      },
    });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}
