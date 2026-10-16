/**
 * ElevenLabs integration (server-only — the API key never reaches the browser).
 *  - Text-to-Speech for reading questions aloud (cached by content hash)
 *  - Speech-to-Text (Scribe) with word-level timestamps for subtitles
 */
import fs from "node:fs/promises";
import path from "node:path";
import { env, elevenLabsConfigured } from "./env";

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryable: boolean,
  ) {
    super(message);
  }
}

export function assertConfigured() {
  if (!elevenLabsConfigured()) {
    throw new ElevenLabsError("Brak konfiguracji ElevenLabs: ustaw ELEVENLABS_API_KEY w pliku .env, aby włączyć lektora i transkrypcję.", 503, false);
  }
}

async function call(pathname: string, init: RequestInit, timeoutMs = 120_000): Promise<Response> {
  assertConfigured();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.elevenLabsBaseUrl}${pathname}`, {
      ...init,
      headers: { "xi-api-key": env.elevenLabsKey, ...(init.headers ?? {}) },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const retryable = res.status === 429 || res.status >= 500;
      throw new ElevenLabsError(`ElevenLabs ${res.status}: ${body.slice(0, 300)}`, res.status, retryable);
    }
    return res;
  } catch (e) {
    if (e instanceof ElevenLabsError) throw e;
    throw new ElevenLabsError(`Nie udało się połączyć z ElevenLabs: ${(e as Error).message}`, 502, true);
  } finally {
    clearTimeout(timer);
  }
}

export interface TtsParams {
  text: string;
  voiceId: string;
  modelId: string;
}

export function ttsCacheKey(p: TtsParams): string {
  return `tts:v1:${p.modelId}:${p.voiceId}:${p.text.trim()}`;
}

export async function synthesize(p: TtsParams): Promise<Buffer> {
  const supportsLanguageCode = /flash|turbo|v3|v4/.test(p.modelId);
  // v3/v4 have no style or speaker-boost controls (and v3 only accepts stability 0 / 0.5 / 1)
  const expressive = /eleven_v[34]/.test(p.modelId);
  const res = await call(`/v1/text-to-speech/${encodeURIComponent(p.voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text: p.text,
      model_id: p.modelId,
      ...(supportsLanguageCode ? { language_code: "pl" } : {}),
      voice_settings: expressive ? { stability: 0.5, similarity_boost: 0.75 } : { stability: 0.5, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true },
    }),
  });
  return Buffer.from(await res.arrayBuffer());
}

export interface Voice {
  voice_id: string;
  name: string;
  labels?: Record<string, string>;
  preview_url?: string;
  category?: string;
}

export async function listVoices(): Promise<Voice[]> {
  const res = await call("/v1/voices", { method: "GET" }, 30_000);
  const data = (await res.json()) as { voices?: Voice[] };
  return data.voices ?? [];
}

export interface SttWord {
  text: string;
  start: number;
  end: number;
  type: "word" | "spacing" | "audio_event" | string;
  logprob?: number;
  speaker_id?: string;
}

export interface SttResult {
  language_code: string;
  language_probability?: number;
  text: string;
  words: SttWord[];
}

/** Transcribe an audio file with Scribe, requesting word-level timestamps. Default language: Polish. */
export async function transcribe(filePath: string, opts: { language?: string; model?: string } = {}): Promise<SttResult & { model: string }> {
  const model = opts.model ?? env.sttModel;
  const buf = await fs.readFile(filePath);
  const form = new FormData();
  form.set("model_id", model);
  form.set("language_code", opts.language ?? "pol");
  form.set("timestamps_granularity", "word");
  form.set("tag_audio_events", "false");
  form.set("diarize", "false");
  form.set("file", new Blob([new Uint8Array(buf)], { type: "audio/mpeg" }), path.basename(filePath));
  const res = await call("/v1/speech-to-text", { method: "POST", body: form }, 600_000);
  const data = (await res.json()) as SttResult;
  if (!Array.isArray(data.words)) throw new ElevenLabsError("Nieoczekiwana odpowiedź transkrypcji (brak znaczników czasu słów)", 502, true);
  return { ...data, model };
}

/**
 * Voice Isolator: removes background noise, room echo and other sounds while
 * keeping the speaker's own voice (comparable to "enhance speech" tools).
 * Output duration matches the input.
 */
export async function isolateVoice(filePath: string): Promise<Buffer> {
  const buf = await fs.readFile(filePath);
  const form = new FormData();
  form.set("audio", new Blob([new Uint8Array(buf)], { type: "audio/mpeg" }), path.basename(filePath));
  const res = await call("/v1/audio-isolation", { method: "POST", body: form }, 600_000);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Scribe v2 Realtime for the teleprompter: a single-use token (15 min, consumed on connect) lets the
 * expert's browser stream microphone audio straight to ElevenLabs without ever seeing the API key.
 */
export async function realtimeSttSession() {
  const res = await call("/v1/single-use-token/realtime_scribe", { method: "POST" }, 15_000);
  const { token } = (await res.json()) as { token: string };
  const params = new URLSearchParams({
    model_id: env.realtimeSttModel,
    token,
    audio_format: "pcm_16000",
    commit_strategy: "vad",
    vad_silence_threshold_secs: "0.6",
    language_code: "pl",
  });
  const wsBase = env.elevenLabsBaseUrl.replace(/^http/, "ws");
  return { url: `${wsBase}/v1/speech-to-text/realtime?${params}`, sampleRate: 16000 };
}
