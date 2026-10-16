import type { AiBrollItem, EditorDocument, ImageOverlay } from "./types";
import { uid } from "./id";

/** Full-frame infographic image for the moment's length (fades in under the question and captions). */
export function infographicOverlay(item: Pick<AiBrollItem, "start" | "end" | "title" | "infographic"> & { kind?: AiBrollItem["kind"] }, assetId: string, total: number): ImageOverlay {
  const start = Math.max(0, Math.min(item.start, total - 0.5));
  return {
    id: uid("ovl"),
    kind: "image",
    name: (item.kind === "illustration" ? `Ilustracja: ${item.title}` : `Infografika: ${item.infographic?.headline ?? item.title}`).slice(0, 80),
    assetId,
    fit: "cover",
    start,
    end: Math.min(total, start + Math.max(2, item.end - item.start)),
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    opacity: 1,
    animation: "fade",
  };
}

/**
 * Add the automatically placed AI visuals from the server document to a locally edited one
 * (the Studio was open while the worker placed them): new AI items and their layers are taken
 * over, everything else stays as edited locally.
 */
export function mergeAutoVisuals(local: EditorDocument, server: EditorDocument): EditorDocument {
  if (!server.meta.autoVisuals || local.meta.autoVisuals === server.meta.autoVisuals) return local;
  const known = new Set((local.meta.aiBroll ?? []).map((i) => i.id));
  const added = (server.meta.aiBroll ?? []).filter((i) => !known.has(i.id));
  const layerIds = new Set(added.map((i) => i.overlayId).filter(Boolean));
  const localLayers = new Set(local.overlays.map((o) => o.id));
  const layers = server.overlays.filter((o) => layerIds.has(o.id) && !localLayers.has(o.id));
  return {
    ...local,
    overlays: [...layers, ...local.overlays],
    meta: { ...local.meta, aiBroll: [...(local.meta.aiBroll ?? []), ...added], autoVisuals: server.meta.autoVisuals },
  };
}
