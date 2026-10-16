import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env, higgsfieldConfigured } from "./env";

/**
 * Higgsfield text-to-video (https://docs.higgsfield.ai). Requests are asynchronous:
 * POST {base}/{model} → { request_id, status } → poll GET {base}/requests/{id}/status until
 * "completed" (video.url), "failed" or "nsfw" (credits are refunded for the last two).
 * Credentials stay on the server: `Authorization: Key KEY_ID:KEY_SECRET`.
 */

export interface VideoModel {
  id: string;
  label: string;
  description: string;
  durations: number[];
  /** extra body fields for this model (e.g. no generated soundtrack — the expert keeps talking underneath) */
  extra?: Record<string, unknown>;
}

export const VIDEO_MODELS: VideoModel[] = [
  {
    id: "kling-video/v3.0/pro/text-to-video",
    label: "Kling 3.0 Pro (zalecany)",
    description: "Najlepszy realizm i płynny ruch kamery, natywnie 9:16 — idealny na przebitki do rolek.",
    durations: [5, 10],
  },
  {
    id: "bytedance/seedance-2.5/text-to-video",
    label: "Seedance 2.5",
    description: "Bardzo dobra spójność scen i kadrów, mocny w ujęciach z ludźmi i dynamicznym montażu.",
    durations: [5, 10],
    extra: { generate_audio: false },
  },
  {
    id: "kling-video/v3.0/std/text-to-video",
    label: "Kling 3.0 Standard (taniej)",
    description: "Ta sama rodzina co Pro, niższy koszt i nieco mniej szczegółów.",
    durations: [5, 10],
  },
];

export function videoModel(id: string | null | undefined): VideoModel {
  return VIDEO_MODELS.find((m) => m.id === id) ?? VIDEO_MODELS.find((m) => m.id === env.higgsfieldModel) ?? VIDEO_MODELS[0];
}

export class HiggsfieldError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
  ) {
    super(message);
  }
}

interface StatusResponse {
  status: "queued" | "in_progress" | "completed" | "failed" | "nsfw" | string;
  request_id: string;
  video?: { url: string } | null;
  images?: Array<{ url: string }> | null;
  error?: string | null;
  detail?: unknown;
}

async function call(path: string, init: RequestInit = {}): Promise<StatusResponse> {
  if (!higgsfieldConfigured()) throw new HiggsfieldError("Higgsfield nie jest skonfigurowany — ustaw HIGGSFIELD_CREDENTIALS (KEY_ID:KEY_SECRET).", false);
  let res: Response;
  try {
    res = await fetch(`${env.higgsfieldBaseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Key ${env.higgsfieldCredentials}`, "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new HiggsfieldError(`Brak połączenia z Higgsfield: ${(e as Error).message}`, true);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail = typeof body === "object" && body ? JSON.stringify((body as { detail?: unknown; message?: unknown }).detail ?? (body as { message?: unknown }).message ?? body) : String(body ?? "");
    const short = detail.slice(0, 300);
    if (res.status === 401 || res.status === 403) throw new HiggsfieldError(`Higgsfield odrzucił klucz API (HTTP ${res.status}). Sprawdź HIGGSFIELD_CREDENTIALS. ${short}`, false);
    if (res.status === 402) throw new HiggsfieldError(`Brak kredytów na koncie Higgsfield. ${short}`, false);
    if (res.status === 400 || res.status === 404 || res.status === 422) throw new HiggsfieldError(`Higgsfield odrzucił zapytanie (HTTP ${res.status}): ${short}`, false);
    throw new HiggsfieldError(`Higgsfield: HTTP ${res.status} ${short}`, true);
  }
  return body as StatusResponse;
}

export async function submitVideo(prompt: string, modelId: string, duration: number, aspectRatio: "9:16" | "16:9" | "1:1"): Promise<string> {
  const model = videoModel(modelId);
  const r = await call(`/${model.id}`, {
    method: "POST",
    body: JSON.stringify({ prompt, duration, aspect_ratio: aspectRatio, ...(model.extra ?? {}) }),
  });
  if (!r?.request_id) throw new HiggsfieldError("Higgsfield nie zwrócił identyfikatora zadania", true);
  return r.request_id;
}

/** Text-to-image model used for infographic illustrations (README of the official SDK). */
export function imageModelId() {
  return process.env.HIGGSFIELD_IMAGE_MODEL || "flux-pro/kontext/max/text-to-image";
}

export async function submitImage(prompt: string, aspectRatio: "9:16" | "16:9" | "1:1"): Promise<string> {
  const r = await call(`/${imageModelId()}`, { method: "POST", body: JSON.stringify({ prompt, aspect_ratio: aspectRatio, safety_tolerance: 2 }) });
  if (!r?.request_id) throw new HiggsfieldError("Higgsfield nie zwrócił identyfikatora zadania", true);
  return r.request_id;
}

/** Poll until the request is done; returns the finished response (video and/or images). */
async function waitForResult(requestId: string, timeoutMs: number): Promise<StatusResponse> {
  const deadline = Date.now() + timeoutMs;
  let delay = 3000;
  for (;;) {
    const r = await call(`/requests/${encodeURIComponent(requestId)}/status`).catch((e: HiggsfieldError) => {
      if (e.retryable) return null; // transient — keep polling
      throw e;
    });
    if (r) {
      if (r.status === "completed") return r;
      if (r.status === "nsfw") throw new HiggsfieldError("Higgsfield odrzucił prompt przez moderację treści (kredyty zwrócone). Zmień opis sceny.", false);
      if (r.status === "failed") throw new HiggsfieldError(`Generowanie w Higgsfield nie powiodło się (kredyty zwrócone)${r.error ? `: ${r.error}` : ""}`, false);
    }
    if (Date.now() > deadline) throw new HiggsfieldError("Higgsfield generuje zbyt długo — spróbuj ponownie później", true);
    await new Promise((res) => setTimeout(res, delay));
    delay = Math.min(10_000, delay + 1000);
  }
}

/** Poll until the clip is ready; returns the video URL. */
export async function waitForVideo(requestId: string, timeoutMs = 20 * 60_000): Promise<string> {
  const r = await waitForResult(requestId, timeoutMs);
  if (!r.video?.url) throw new HiggsfieldError("Higgsfield zakończył zadanie, ale nie zwrócił wideo", false);
  return r.video.url;
}

/** Poll until the image is ready; returns the image URL. */
export async function waitForImage(requestId: string, timeoutMs = 10 * 60_000): Promise<string> {
  const r = await waitForResult(requestId, timeoutMs);
  const url = r.images?.[0]?.url;
  if (!url) throw new HiggsfieldError("Higgsfield zakończył zadanie, ale nie zwrócił obrazu", false);
  return url;
}

export async function downloadFile(url: string, dest: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok || !res.body) throw new HiggsfieldError(`Nie udało się pobrać pliku z Higgsfield (HTTP ${res.status})`, true);
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), fs.createWriteStream(dest));
}
