import fsp from "node:fs/promises";
import path from "node:path";
import { prisma } from "./db";
import { makeTempDir, putFile } from "./storage";
import { makePreviewProxy, probe, run } from "./ffmpeg";
import { env } from "./env";
import { randomToken } from "./crypto";
import { HttpError } from "./errors";

/** Store an admin upload after validating it by probing the actual content. */
export async function storeUpload(file: File, kind: "MUSIC" | "IMAGE" | "LOGO" | "OVERLAY_VIDEO", ext: string, projectId: string | null) {
  const dir = await makeTempDir("upload");
  try {
    let p = path.join(dir, `f.${ext}`);
    await fsp.writeFile(p, Buffer.from(await file.arrayBuffer()));
    let info = await probe(p).catch(() => null);
    let mime = file.type;
    if (kind === "OVERLAY_VIDEO") {
      if (!info?.hasVideo) throw new HttpError(415, "Plik wideo jest uszkodzony lub ma nieprawidłowy format");
      if (info.duration > 300) throw new HttpError(413, "Wideo warstwy może mieć maksymalnie 5 minut");
      // convert to H.264/AAC MP4 (plays in every browser and decodes reliably in the renderer); GIFs become video too
      const out = path.join(dir, "overlay.mp4");
      await run(env.ffmpeg, [
        "-hide_banner", "-y", "-i", p,
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',fps=30,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", "30", "-threads", process.env.FFMPEG_THREADS ?? "2",
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", out,
      ]);
      p = out;
      ext = "mp4";
      mime = "video/mp4";
      info = await probe(p);
    }
    if (!info || (kind === "MUSIC" && !info.hasAudio) || (kind !== "MUSIC" && !info.hasVideo)) throw new HttpError(415, "Plik jest uszkodzony lub ma nieprawidłowy format");
    const key = `projects/${projectId ?? "shared"}/uploads/${randomToken(12)}.${ext}`;
    const size = await putFile(key, p, mime);
    // WebM preview proxy so the layer also plays in browsers without H.264 (export uses the MP4)
    let proxyAssetId: string | null = null;
    if (kind === "OVERLAY_VIDEO") {
      const proxyPath = path.join(dir, "proxy.webm");
      await makePreviewProxy(p, proxyPath);
      const pKey = key.replace(/\.mp4$/, ".proxy.webm");
      const pSize = await putFile(pKey, proxyPath, "video/webm");
      const pa = await prisma.mediaAsset.create({ data: { kind: "PREVIEW_PROXY", projectId, storageKey: pKey, mimeType: "video/webm", sizeBytes: pSize, durationSec: info.duration, hasAudio: info.hasAudio, hasVideo: true } });
      proxyAssetId = pa.id;
    }
    return prisma.mediaAsset.create({
      data: {
        kind,
        projectId,
        storageKey: key,
        mimeType: mime,
        sizeBytes: size,
        durationSec: kind === "MUSIC" || kind === "OVERLAY_VIDEO" ? info.duration : null,
        width: info.width,
        height: info.height,
        hasAudio: info.hasAudio,
        hasVideo: kind !== "MUSIC",
        originalName: file.name.slice(0, 120),
        ...(proxyAssetId ? { meta: { proxyAssetId } } : {}),
      },
    });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}
