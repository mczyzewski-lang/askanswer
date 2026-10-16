import { prisma } from "./db";
import { signedUrl, deleteObject } from "./storage";
import type { AssetInfo, Waveform } from "../editor/types";

export async function assetInfo(id: string, withWaveform = false): Promise<AssetInfo | null> {
  const a = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!a) return null;
  const proxyId = (a.meta as { proxyAssetId?: string } | null)?.proxyAssetId;
  const proxy = proxyId ? await prisma.mediaAsset.findUnique({ where: { id: proxyId } }) : null;
  const maskId = (a.meta as { maskAssetId?: string } | null)?.maskAssetId;
  const mask = maskId ? await prisma.mediaAsset.findUnique({ where: { id: maskId } }) : null;
  return {
    id: a.id,
    kind: a.kind,
    url: await signedUrl(a.storageKey, { ttlSec: 12 * 3600 }),
    proxyUrl: proxy ? await signedUrl(proxy.storageKey, { ttlSec: 12 * 3600 }) : null,
    durationSec: a.durationSec,
    width: a.width,
    height: a.height,
    hasAudio: a.hasAudio,
    hasVideo: a.hasVideo,
    waveform: withWaveform ? ((a.waveform as unknown as Waveform) ?? null) : undefined,
    label: a.originalName ?? undefined,
    variant: (a.meta as { mode?: string } | null)?.mode ?? null,
    strength: (a.meta as { strength?: string } | null)?.strength ?? null,
    voiceId: (a.meta as { voiceId?: string } | null)?.voiceId ?? null,
    maskUrl: mask ? await signedUrl(mask.storageKey, { ttlSec: 12 * 3600 }) : null,
  };
}

export async function deleteAssets(ids: Array<string | null | undefined>) {
  for (const id of ids) {
    if (!id) continue;
    const a = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!a) continue;
    const proxyId = (a.meta as { proxyAssetId?: string } | null)?.proxyAssetId;
    if (proxyId) await deleteAssets([proxyId]);
    const maskId = (a.meta as { maskAssetId?: string } | null)?.maskAssetId;
    if (maskId) await deleteAssets([maskId]);
    // narration assets are shared via the TTS cache — keep them
    if (a.kind === "NARRATION") continue;
    await deleteObject(a.storageKey).catch(() => {});
    await prisma.mediaAsset.delete({ where: { id } }).catch(() => {});
  }
}
