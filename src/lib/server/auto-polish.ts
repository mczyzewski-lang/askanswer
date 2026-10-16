import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { elevenLabsConfigured } from "./env";
import { suggestZooms } from "../editor/zoom";
import type { EditorDocument, PictureLook } from "../editor/types";

/**
 * Right after a recording is processed (like the AI illustrations): the project's default
 * finishing — blurred background, voice "podcast + ElevenLabs", dynamic zooms and, if enabled,
 * the automatic picture correction. Each part is independent: one failing (e.g. no ElevenLabs
 * key) does not stop the others; the reasons are returned. Runs once per composition.
 */
export const BLUR_DEFAULT = 45;

export interface AutoPolishResult {
  done: string[];
  warnings: string[];
  skipped?: string;
}

export async function autoPolish(compositionId: string): Promise<AutoPolishResult> {
  const comp = await prisma.videoComposition.findUnique({ where: { id: compositionId }, include: { project: true } });
  if (!comp) return { done: [], warnings: [], skipped: "no composition" };
  const p = comp.project;
  const doc0 = comp.document as unknown as EditorDocument;
  if (doc0.meta.autoPolish) return { done: [], warnings: [], skipped: "already done" };
  if (!p.autoBlur && !p.autoVoice && !p.autoZooms && !p.autoImageEnhance) return { done: [], warnings: [], skipped: "disabled" };
  const assets = [...new Set(doc0.clips.map((c) => c.assetId))];
  const done: string[] = [];
  const warnings: string[] = [];

  let masked = false;
  if (p.autoBlur) {
    try {
      const { segmentAsset } = await import("./segment");
      for (const a of assets) await segmentAsset(a);
      masked = true;
      done.push("blur");
    } catch (e) {
      warnings.push(`Rozmycie tła: ${(e as Error).message}`);
    }
  }
  let voice: Record<string, string> | null = null;
  if (p.autoVoice) {
    if (!elevenLabsConfigured()) warnings.push("Głos podcast + ElevenLabs: brak klucza ELEVENLABS_API_KEY.");
    else
      try {
        const { enhanceComposition } = await import("./enhance");
        voice = await enhanceComposition(compositionId, "isolator", "podcast");
        done.push("voice");
      } catch (e) {
        warnings.push(`Głos podcast + ElevenLabs: ${(e as Error).message}`);
      }
  }
  const looks: Record<string, PictureLook> = {};
  if (p.autoImageEnhance) {
    try {
      const { analyzeLook } = await import("./look");
      for (const a of assets) looks[a] = await analyzeLook(a);
      done.push("look");
    } catch (e) {
      warnings.push(`Poprawa obrazu: ${(e as Error).message}`);
    }
  }

  // write into the latest document (the editor may have saved meanwhile): optimistic, retried
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await prisma.videoComposition.findUniqueOrThrow({ where: { id: compositionId } });
    const doc = cur.document as unknown as EditorDocument;
    if (doc.meta.autoPolish) return { done: [], warnings, skipped: "already done" };
    const clips = doc.clips.map((c) => ({
      ...c,
      ...(masked && !c.background ? { background: { blur: BLUR_DEFAULT } } : {}),
      ...(voice?.[c.assetId] && !c.audioAssetId ? { audioAssetId: voice[c.assetId] } : {}),
      ...(looks[c.assetId] && !c.look ? { look: looks[c.assetId] } : {}),
    }));
    let zooms = doc.zooms;
    if (p.autoZooms && !doc.zooms.length) {
      const base = doc.clips[0]?.framing;
      zooms = suggestZooms({ ...doc, clips }, "standard", base ? { cx: base.cx, cy: base.cy } : undefined).map((z) => ({ ...z, suggested: false }));
      if (zooms.length) done.push("zooms");
    }
    const next: EditorDocument = { ...doc, clips, zooms, meta: { ...doc.meta, autoPolish: `p${Date.now().toString(36)}` } as EditorDocument["meta"] };
    const r = await prisma.videoComposition.updateMany({ where: { id: compositionId, version: cur.version }, data: { document: next as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
    if (r.count === 1) return { done, warnings };
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error("Nie udało się zapisać automatycznej obróbki — kompozycja była w tym czasie edytowana.");
}
