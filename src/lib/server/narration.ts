import { prisma } from "./db";
import { sha256 } from "./crypto";
import { env } from "./env";
import { listVoices, synthesize, ttsCacheKey } from "./elevenlabs";
import { putBuffer, makeTempDir } from "./storage";
import { probe } from "./ffmpeg";
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
