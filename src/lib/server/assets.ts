import { prisma } from "./db";
import { signedUrl, deleteObject } from "./storage";
import type { AssetInfo, Waveform } from "../editor/types";

export async function assetInfo(id: string, withWaveform = false): Promise<AssetInfo | null> {
  const a = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!a) return null;
  const proxyId = (a.meta as { proxyAssetId?: string } | null)?.proxyAssetId;
  const proxy = proxyId ? await prisma.mediaAsset.findUnique({ where: { id: proxyId } }) : null;
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
  };
}

export async function deleteAssets(ids: Array<string | null | undefined>) {
  for (const id of ids) {
    if (!id) continue;
    const a = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!a) continue;
    const proxyId = (a.meta as { proxyAssetId?: string } | null)?.proxyAssetId;
    if (proxyId) await deleteAssets([proxyId]);
    // narration assets are shared via the TTS cache — keep them
    if (a.kind === "NARRATION") continue;
    await deleteObject(a.storageKey).catch(() => {});
    await prisma.mediaAsset.delete({ where: { id } }).catch(() => {});
  }
}
