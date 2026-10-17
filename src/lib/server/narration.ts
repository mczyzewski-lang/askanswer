import { prisma } from "./db";
import { sha256 } from "./crypto";
import { env } from "./env";
import { listVoices, synthesize, transcribe, ttsCacheKey } from "./elevenlabs";
import { putBuffer, putFile, makeTempDir, toLocalFile } from "./storage";
import { changeTempo, probe } from "./ffmpeg";
import fsp from "node:fs/promises";
import path from "node:path";
import { stablePick, withFillers } from "../fillers";
import { detectSpeakerGender, genderFromVoiceLabels, genderFromVoiceName } from "../speaker-gender";
import { elevenLabsConfigured } from "./env";

const inflight = new Map<string, Promise<string>>();

/**
 * Get (or generate once) the ElevenLabs narration for a text. Identical
 * text+voice+model combinations are cached by content hash, so repeated
 * playback never pays for synthesis twice. Returns the MediaAsset id.
 */
export async function ensureNarration(text: string, opts: { voiceId?: string | null; modelId?: string | null; projectId?: string | null } = {}): Promise<string> {
  const params = { text: text.trim(), voiceId: opts.voiceId || env.defaultVoiceId, modelId: opts.modelId || env.ttsModel };
  const hash = sha256(ttsCacheKey(params));
  const cached = await prisma.mediaAsset.findUnique({ where: { contentHash: hash } });
  if (cached) return cached.id;
  const running = inflight.get(hash);
  if (running) return running;
  const p = (async () => {
    const audio = await synthesize(params);
    const key = `narration/${hash.slice(0, 2)}/${hash}.mp3`;
    const size = await putBuffer(key, audio, "audio/mpeg");
    const dir = await makeTempDir("tts");
    let duration = 0;
    try {
      const f = path.join(dir, "a.mp3");
      await fsp.writeFile(f, audio);
      duration = (await probe(f)).duration;
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
    const asset = await prisma.mediaAsset.upsert({
      where: { contentHash: hash },
      create: {
        kind: "NARRATION",
        projectId: opts.projectId ?? null,
        storageKey: key,
        mimeType: "audio/mpeg",
        sizeBytes: size,
        durationSec: duration,
        hasAudio: true,
        contentHash: hash,
        meta: { voiceId: params.voiceId, modelId: params.modelId, text: params.text },
      },
      update: {},
    });
    return asset.id;
  })();
  inflight.set(hash, p);
  try {
    return await p;
  } finally {
    inflight.delete(hash);
  }
}

/** The narration at another tempo (same voice and pitch), cached per source asset and speed. */
export async function narrationAtSpeed(baseAssetId: string, speed: number): Promise<string> {
  const sp = Math.round(Math.min(1.6, Math.max(0.8, speed)) * 100) / 100;
  if (Math.abs(sp - 1) < 0.005) return baseAssetId;
  const base = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: baseAssetId } });
  const hash = sha256(`tempo:${base.id}:${sp}`);
  const cached = await prisma.mediaAsset.findUnique({ where: { contentHash: hash } });
  if (cached) return cached.id;
  const src = await toLocalFile(base.storageKey);
  const dir = await makeTempDir("tempo");
  try {
    const out = path.join(dir, "a.mp3");
    await changeTempo(src.path, out, sp);
    const key = `narration/${hash.slice(0, 2)}/${hash}.mp3`;
    const size = await putFile(key, out, "audio/mpeg");
    const duration = (await probe(out)).duration;
    const asset = await prisma.mediaAsset.upsert({
      where: { contentHash: hash },
      create: { kind: "NARRATION", projectId: base.projectId, storageKey: key, mimeType: "audio/mpeg", sizeBytes: size, durationSec: duration, hasAudio: true, contentHash: hash, meta: { ...((base.meta as object | null) ?? {}), baseAssetId: base.id, speed: sp } },
      update: {},
    });
    return asset.id;
  } finally {
    await src.cleanup();
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

export type NarrationWord = { text: string; start: number; end: number };

/** Words spread over the duration by their length — when no transcription is possible. */
export function evenWords(text: string, duration: number): NarrationWord[] {
  const parts = text.split(/\s+/).filter(Boolean);
  const total = parts.reduce((n, w) => n + w.length + 1, 0) || 1;
  const lead = Math.min(0.15, duration * 0.05);
  const span = Math.max(0.1, duration - lead * 2);
  let t = lead;
  return parts.map((w) => {
    const d = (span * (w.length + 1)) / total;
    const word = { text: w, start: t, end: t + d * 0.92 };
    t += d;
    return word;
  });
}

/**
 * Word timestamps of a narration file (for the question's subtitles), in the time of the ORIGINAL
 * generated file (a re-timed copy maps back through its base). Transcribed once and kept on the asset.
 */
export async function narrationWords(assetId: string): Promise<{ baseAssetId: string; words: NarrationWord[] }> {
  let a = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
  const baseId = (a.meta as { baseAssetId?: string } | null)?.baseAssetId;
  if (baseId) a = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: baseId } });
  const meta = (a.meta ?? {}) as { words?: NarrationWord[]; text?: string };
  if (Array.isArray(meta.words) && meta.words.length) return { baseAssetId: a.id, words: meta.words };
  let words: NarrationWord[] = [];
  if (elevenLabsConfigured()) {
    const f = await toLocalFile(a.storageKey);
    try {
      const r = await transcribe(f.path, { language: "pol" });
      words = r.words.filter((w) => (w.type ?? "word") === "word" && w.text.trim()).map((w) => ({ text: w.text.trim(), start: w.start, end: w.end }));
    } catch {
      words = [];
    } finally {
      await f.cleanup();
    }
  }
  if (!words.length && meta.text) words = evenWords(meta.text, a.durationSec ?? 3);
  if (words.length) await prisma.mediaAsset.update({ where: { id: a.id }, data: { meta: { ...meta, words } } });
  return { baseAssetId: a.id, words };
}

interface NarrationProject {
  id: string;
  voiceId: string | null;
  ttsModel: string | null;
  voiceCollectionId: string | null;
  naturalFillers: boolean;
}

let voiceCache: { at: number; map: Map<string, { name: string; labels: Record<string, string> }> } | null = null;
/** ElevenLabs voice names/labels (cached 10 min) — for collection items without a "Pan"/"Pani" label. */
async function accountVoices() {
  if (voiceCache && Date.now() - voiceCache.at < 600_000) return voiceCache.map;
  const map = new Map<string, { name: string; labels: Record<string, string> }>();
  if (elevenLabsConfigured()) {
    try {
      for (const v of await listVoices()) map.set(v.voice_id, { name: v.name, labels: v.labels ?? {} });
    } catch {
      /* fall back to labels only */
    }
  }
  voiceCache = { at: Date.now(), map };
  return map;
}

/**
 * The narrator voice for a question: a stable random pick from the project's collection, else the
 * project voice. When the question reveals the asker ("…powiedzieć mężowi…" → a woman), only the
 * collection's matching voices are used: "Pani …" for women, "Pan …" for men.
 */
export async function narratorVoice(project: NarrationProject, question: { id: string; text: string }): Promise<string | null> {
  if (project.voiceCollectionId) {
    const items = await prisma.voiceCollectionItem.findMany({ where: { collectionId: project.voiceCollectionId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { voiceId: true, label: true } });
    let pool = items;
    const asker = detectSpeakerGender(question.text);
    if (asker && items.length > 1) {
      let genders = items.map((i) => genderFromVoiceName(i.label));
      if (genders.some((g) => g === null)) {
        const account = await accountVoices();
        genders = items.map((i, k) => genders[k] ?? genderFromVoiceName(account.get(i.voiceId)?.name) ?? genderFromVoiceLabels(account.get(i.voiceId)?.labels));
      }
      const matching = items.filter((_, k) => genders[k] === asker);
      if (matching.length) pool = matching;
    }
    const pick = stablePick(pool.map((i) => i.voiceId), `${project.id}:${question.id}`);
    if (pick) return pick;
  }
  return project.voiceId;
}

/** Narration of a question with the project's settings (voice/collection, model, natural hesitations). */
export async function questionNarration(project: NarrationProject, question: { id: string; text: string; spokenText?: string | null }, override: { voiceId?: string | null; modelId?: string | null; text?: string } = {}) {
  // the narrator reads the client's question; the video title (text) when no separate one is given
  const base = override.text ?? (question.spokenText?.trim() || question.text);
  const text = project.naturalFillers ? withFillers(base, question.id) : base;
  const voiceId = override.voiceId || (await narratorVoice(project, { id: question.id, text: base }));
  return ensureNarration(text, { voiceId, modelId: override.modelId || project.ttsModel, projectId: project.id });
}
