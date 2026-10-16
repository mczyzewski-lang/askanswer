import { prisma } from "./db";
import { sha256 } from "./crypto";
import { env } from "./env";
import { synthesize, ttsCacheKey } from "./elevenlabs";
import { putBuffer, makeTempDir } from "./storage";
import { probe } from "./ffmpeg";
import fsp from "node:fs/promises";
import path from "node:path";
import { stablePick, withFillers } from "../fillers";

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

/** The narrator voice for a question: a stable random pick from the project's collection, else the project voice. */
export async function narratorVoice(project: NarrationProject, questionId: string): Promise<string | null> {
  if (project.voiceCollectionId) {
    const items = await prisma.voiceCollectionItem.findMany({ where: { collectionId: project.voiceCollectionId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { voiceId: true } });
    const pick = stablePick(items.map((i) => i.voiceId), `${project.id}:${questionId}`);
    if (pick) return pick;
  }
  return project.voiceId;
}

/** Narration of a question with the project's settings (voice/collection, model, natural hesitations). */
export async function questionNarration(project: NarrationProject, question: { id: string; text: string }, override: { voiceId?: string | null; modelId?: string | null; text?: string } = {}) {
  const base = override.text ?? question.text;
  const text = project.naturalFillers ? withFillers(base, question.id) : base;
  const voiceId = override.voiceId || (await narratorVoice(project, question.id));
  return ensureNarration(text, { voiceId, modelId: override.modelId || project.ttsModel, projectId: project.id });
}
