import fsp from "node:fs/promises";
import path from "node:path";
import { prisma } from "./db";
import { putBuffer } from "./storage";
import { randomToken } from "./crypto";
import { THEME_PRESETS } from "../themes";

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (b: Buffer) => (b.length > 24 && b.readUInt32BE(12) === 0x49484452 ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : { width: null, height: null });

/**
 * A preset that comes with its brand logo (public/presets): stores a copy as the theme's own logo
 * asset, so it can later be replaced or removed like an uploaded one. null = the preset has no logo.
 */
export async function presetLogoAssetId(presetKey: string | null | undefined, projectId: string | null, variant: "light" | "dark" = "light"): Promise<string | null> {
  const preset = THEME_PRESETS.find((t) => t.key === presetKey);
  const file = variant === "dark" ? preset?.logoDarkFile : preset?.logoFile;
  if (!file) return null;
  const buf = await fsp.readFile(path.join(process.cwd(), "public", "presets", file)).catch(() => null);
  if (!buf) return null;
  const key = `projects/${projectId ?? "shared"}/uploads/${randomToken(12)}.png`;
  const size = await putBuffer(key, buf, "image/png");
  const asset = await prisma.mediaAsset.create({
    data: { kind: "LOGO", projectId, storageKey: key, mimeType: "image/png", sizeBytes: size, ...pngSize(buf), hasAudio: false, hasVideo: true, originalName: file },
  });
  return asset.id;
}

/** both logos of a preset (light / dark backgrounds) as theme fields; {} when it has none */
export async function presetLogos(presetKey: string | null | undefined, projectId: string | null) {
  const light = await presetLogoAssetId(presetKey, projectId, "light");
  const dark = await presetLogoAssetId(presetKey, projectId, "dark");
  return { ...(light ? { logoAssetId: light } : {}), ...(dark ? { logoDarkAssetId: dark } : {}) };
}
