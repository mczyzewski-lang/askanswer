/**
 * ElevenLabs Image & Video API (Flows): text → short video (Google Veo 3.1 behind ElevenLabs).
 * POST /v1/flows/video {model_id, prompt, …} → {id, status:"pending"}; GET /v1/flows/video/{id} →
 * {status: pending | generating | completed | failed, content_url?, failure_reason?, error_message?}.
 * Needs a paid (Pro) ElevenLabs plan; the clip is downloaded at once (the URL expires after ~1 h).
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { prisma } from "./db";
import { env } from "./env";
import { makeTempDir } from "./storage";
import { ingestOverlayVideo } from "./uploads";

export const EL_VIDEO_MODELS = [
  { id: "veo-3.1-fast-generate-001", label: "Veo 3.1 Fast (szybciej, taniej)", durations: [4, 6, 8] },
  { id: "veo-3.1-generate-001", label: "Veo 3.1 (najwyższa jakość)", durations: [4, 6, 8] },
] as const;
export type ElVideoModel = (typeof EL_VIDEO_MODELS)[number]["id"];

/** A failure the user should read (plan, key, content) — not worth retrying. */
export class ElVideoError extends Error {
  constructor(
    message: string,
    readonly permanent = true,
  ) {
    super(message);
  }
}

const headers = () => ({ "xi-api-key": env.elevenLabsKey, "Content-Type": "application/json" });

function explain(status: number, body: { detail?: unknown; error?: unknown; message?: unknown }) {
  const raw = JSON.stringify(body.detail ?? body.error ?? body.message ?? body).slice(0, 400);
  if (status === 401) return "ElevenLabs odrzucił klucz API (ELEVENLABS_API_KEY).";
  if (status === 402 || /paid_plan|plan/i.test(raw)) return "Generowanie wideo w ElevenLabs wymaga płatnego planu (Pro lub wyższy).";
  if (status === 403 || /access_denied|permission/i.test(raw)) return `ElevenLabs: brak dostępu do generowania wideo dla tego klucza (${raw}).`;
  if (status === 429) return "ElevenLabs: limit zapytań — spróbuj za chwilę.";
  return `ElevenLabs (HTTP ${status}): ${raw}`;
}

/** Start a generation; models that refuse an optional field are retried with the plain prompt. */
export async function submitElVideo(p: { prompt: string; model: ElVideoModel; duration: number; aspect: "9:16" | "16:9" | "1:1" }): Promise<string> {
  const base = { model_id: p.model, prompt: p.prompt };
  const bodies = [
    { ...base, aspect_ratio: p.aspect === "1:1" ? "9:16" : p.aspect, duration_secs: p.duration, generate_audio: false },
    { ...base, aspect_ratio: p.aspect === "1:1" ? "9:16" : p.aspect, duration_secs: p.duration },
    base,
  ];
  let last = "";
  for (const body of bodies) {
    const res = await fetch(`${env.elevenLabsBaseUrl}/v1/flows/video`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    const data = (await res.json().catch(() => ({}))) as { id?: string; generation_id?: string; detail?: unknown };
    if (res.ok && (data.id || data.generation_id)) return String(data.id ?? data.generation_id);
    last = explain(res.status, data);
    // 422: a field this model does not take — try a simpler body; anything else is final
    if (res.status !== 422) throw new ElVideoError(last, res.status !== 429 && res.status < 500);
  }
  throw new ElVideoError(last);
}

/** Wait for the generation (polling) and return the URL of the finished clip. */
export async function waitForElVideo(id: string, timeoutMs = 12 * 60_000): Promise<string> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${env.elevenLabsBaseUrl}/v1/flows/video/${encodeURIComponent(id)}`, { headers: headers(), signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (res?.ok) {
      const d = (await res.json().catch(() => ({}))) as { status?: string; content_url?: string; failure_reason?: string; error_message?: string };
      if (d.status === "completed" && d.content_url) return d.content_url;
      if (d.status === "failed") throw new ElVideoError(`ElevenLabs nie wygenerował wideo: ${d.error_message ?? d.failure_reason ?? "nieznany powód"}`);
    } else if (res && res.status < 500 && res.status !== 429) {
      throw new ElVideoError(explain(res.status, (await res.json().catch(() => ({}))) as Record<string, unknown>));
    }
    if (Date.now() > until) throw new ElVideoError("ElevenLabs generuje wideo zbyt długo — spróbuj ponownie później.", false);
    await new Promise((r) => setTimeout(r, Number(process.env.EL_VIDEO_POLL_MS ?? 5000)));
  }
}

async function download(url: string, dest: string) {
  // a signed URL; if the host wants the key, send it (only to ElevenLabs' own API host)
  let res = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
  if ((res.status === 401 || res.status === 403) && url.startsWith(env.elevenLabsBaseUrl)) res = await fetch(url, { headers: { "xi-api-key": env.elevenLabsKey }, signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok || !res.body) throw new ElVideoError(`Nie udało się pobrać wideo z ElevenLabs (HTTP ${res.status})`, false);
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), fs.createWriteStream(dest));
}

/** Worker "generate-video-el": generate, download, store as a muted full-frame clip of the project. */
export async function generateElVideo(jobId: string, p: { compositionId: string; prompt: string; duration: number; model: ElVideoModel; aspect: "9:16" | "16:9" | "1:1"; generationId?: string }) {
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id: p.compositionId }, select: { projectId: true } });
  let generationId = p.generationId;
  if (!generationId) {
    generationId = await submitElVideo(p);
    // a retried job keeps waiting for the same generation (never pays twice)
    await prisma.job.update({ where: { id: jobId }, data: { payload: { ...p, generationId } } });
  }
  const url = await waitForElVideo(generationId);
  const dir = await makeTempDir("elvideo");
  try {
    const file = path.join(dir, "elevenlabs.mp4");
    await download(url, file);
    const asset = await ingestOverlayVideo(file, dir, comp.projectId, `AI wideo: ${p.prompt.slice(0, 60)}`, { source: "elevenlabs", model: p.model, generationId });
    return { assetId: asset.id, generationId };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}
