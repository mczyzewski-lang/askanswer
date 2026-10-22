import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { enqueue } from "./jobs";
import { MASK_VERSION } from "../render/mask-format";
import { narrationAtSpeed } from "./narration";
import { retimeNarration } from "../editor/timeline";
import type { EditorDocument, SubtitlePresetKey } from "../editor/types";
import { SUBTITLE_PRESETS } from "../editor/subtitles";

/**
 * The project's video defaults, applied ONCE to every video (also ones recorded before the setting):
 * blurred background at the project strength and the narrator's tempo. A video changed in the Studio
 * afterwards keeps that change. Saved into the composition, so the Studio and the export agree.
 */
export async function applyProjectDefaults(compositionId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const comp = await prisma.videoComposition.findUnique({ where: { id: compositionId }, include: { project: true } });
    if (!comp) return;
    const p = comp.project;
    let doc = comp.document as unknown as EditorDocument;
    const done = { ...(doc.meta.defaults ?? {}) };
    let changed = false;

    // switched on in the settings later: also videos made before get it (unless they were set by hand)
    if (!done.blur && p.autoBlur) {
      done.blur = true;
      changed = true;
      if (doc.clips.length && !doc.clips.some((c) => c.background)) {
        doc = { ...doc, clips: doc.clips.map((c) => ({ ...c, background: { blur: p.blurStrength || 45 } })) };
        // the person masks, if the recording has none yet
        const rows = await prisma.mediaAsset.findMany({ where: { id: { in: [...new Set(doc.clips.map((c) => c.assetId))] } } });
        for (const r of rows)
          if (!(r.meta as { maskAssetId?: string } | null)?.maskAssetId)
            await enqueue("segment-asset", { assetId: r.id }, { idempotencyKey: `segment:${r.id}:v${MASK_VERSION}`, maxAttempts: 2 });
      }
    }

    const n = doc.narration[0];
    const speed = Math.round((p.narrationSpeed || 1) * 100) / 100;
    if (!done.speed && n && Math.abs(speed - 1) > 0.005) {
      done.speed = true;
      changed = true;
      if (Math.abs((n.speed ?? 1) - 1) < 0.005) {
        try {
          const base = n.baseAssetId ?? n.assetId;
          const id = await narrationAtSpeed(base, speed);
          const a = await prisma.mediaAsset.findUniqueOrThrow({ where: { id } });
          const durations = new Map((await prisma.mediaAsset.findMany({ where: { id: { in: doc.clips.map((c) => c.assetId) } }, select: { id: true, durationSec: true } })).map((r) => [r.id, r.durationSec ?? Infinity]));
          doc = retimeNarration(doc, n.id, { assetId: id, duration: a.durationSec ?? 0, baseAssetId: base, speed }, (x) => durations.get(x) ?? Infinity);
        } catch {
          done.speed = false; // try again next time
        }
      }
    }

    // the project's subtitle style: applied to every video whenever the setting changes
    const preset = p.subtitlePreset as SubtitlePresetKey | null;
    if (preset && SUBTITLE_PRESETS[preset] && done.subs !== preset) {
      done.subs = preset;
      changed = true;
      doc = { ...doc, subtitles: { ...doc.subtitles, preset, style: { ...SUBTITLE_PRESETS[preset].style, y: doc.subtitles.style.y } } };
    }

    if (!changed) return;
    doc = { ...doc, meta: { ...doc.meta, defaults: done } };
    const r = await prisma.videoComposition.updateMany({ where: { id: compositionId, version: comp.version }, data: { document: doc as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
    if (r.count === 1) return;
  }
}
