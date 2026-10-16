import fsp from "node:fs/promises";
import { env, openaiConfigured, openaiKeyDiagnostics } from "./env";

/**
 * OpenAI image generation (POST /v1/images/generations). GPT image models always return base64.
 * Used for infographics: either the background illustration or the whole infographic (with text).
 * The key stays on the server.
 */
export class OpenAIImageError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
  ) {
    super(message);
  }
}

/** Portrait/landscape/square size the model accepts, close to the video's aspect ratio. */
export function imageSize(model: string, width: number, height: number, long = env.openaiImageLong): string {
  // gpt-image-2 / 2.5: any WIDTHxHEIGHT divisible by 16 (ratio 1:3..3:1); older GPT image models: fixed sizes.
  // The price grows with the pixels: 1536 on the long side (864×1536) is sharp enough for a phone
  // after upscaling to 1080×1920 and costs ~30% less than 1824.
  if (/^gpt-image-2/.test(model)) {
    const L = Math.max(1024, Math.min(2048, Math.round(long / 16) * 16));
    const short = Math.round(((L * Math.min(width, height)) / Math.max(width, height)) / 16) * 16;
    return width === height ? `${Math.min(L, 1536)}x${Math.min(L, 1536)}` : width < height ? `${short}x${L}` : `${L}x${short}`;
  }
  return width === height ? "1024x1024" : width < height ? "1024x1536" : "1536x1024";
}

/** `out` = one file, or several: that many variants in one request (n), written in order; returns how many came back. */
export async function generateOpenAIImage(prompt: string, opts: { width: number; height: number; out: string | string[]; quality?: "low" | "medium" | "high" }): Promise<number> {
  const outs = Array.isArray(opts.out) ? opts.out : [opts.out];
  if (!openaiConfigured()) throw new OpenAIImageError("OpenAI nie jest skonfigurowany — dodaj OPENAI_API_KEY w Railway → Variables.", false);
  const model = env.openaiImageModel;
  let res: Response;
  try {
    res = await fetch(`${env.openaiBaseUrl}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, size: imageSize(model, opts.width, opts.height), quality: opts.quality ?? env.openaiImageQuality, n: outs.length, output_format: "png" }),
      signal: AbortSignal.timeout(240_000),
    });
  } catch (e) {
    throw new OpenAIImageError(`Brak połączenia z OpenAI: ${(e as Error).message}`, true);
  }
  const body = (await res.json().catch(() => ({}))) as { data?: Array<{ b64_json?: string }>; error?: { message?: string; code?: string; type?: string } };
  if (!res.ok) {
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new OpenAIImageError(`OpenAI odrzucił klucz API (sprawdź OPENAI_API_KEY): ${msg}`, false);
    if (res.status === 403) throw new OpenAIImageError(`Brak dostępu do modelu ${model} na tym koncie OpenAI (organizacja może wymagać weryfikacji): ${msg}`, false);
    if (res.status === 400 && /safety|moderation|content_policy/i.test(`${body.error?.code} ${msg}`)) throw new OpenAIImageError(`OpenAI odrzucił opis przez moderację treści. Zmień tekst lub prompt. (${msg})`, false);
    if (res.status === 429 && /quota|billing/i.test(msg)) throw new OpenAIImageError(`Brak środków na koncie OpenAI: ${msg}`, false);
    throw new OpenAIImageError(`OpenAI: ${msg}`, res.status === 429 || res.status >= 500);
  }
  const images = (body.data ?? []).map((d) => d.b64_json).filter((b): b is string => !!b);
  if (!images.length) throw new OpenAIImageError("OpenAI nie zwrócił obrazu", true);
  for (let i = 0; i < Math.min(images.length, outs.length); i++) await fsp.writeFile(outs[i], Buffer.from(images[i], "base64"));
  return Math.min(images.length, outs.length);
}

/** Connection test without generating anything: list one model. */
export async function checkOpenAI(): Promise<{ ok: boolean; message: string }> {
  if (!openaiConfigured()) return { ok: false, message: `OpenAI: brak działającego klucza. ${openaiKeyDiagnostics()}` };
  const hint = env.openaiKey.startsWith("sk-") ? "" : " Uwaga: klucze OpenAI zaczynają się od „sk-” — sprawdź, czy wkleiłeś właściwą wartość.";
  try {
    const res = await fetch(`${env.openaiBaseUrl}/models/${encodeURIComponent(env.openaiImageModel)}`, { headers: { Authorization: `Bearer ${env.openaiKey}` }, signal: AbortSignal.timeout(20_000) });
    if (res.ok) return { ok: true, message: `Połączenie z OpenAI działa (model ${env.openaiImageModel}).` };
    const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (res.status === 401) return { ok: false, message: `OpenAI odrzucił klucz API — sprawdź OPENAI_API_KEY.${hint}` };
    if (res.status === 404) return { ok: false, message: `Klucz działa, ale model ${env.openaiImageModel} nie jest dostępny na tym koncie. Ustaw OPENAI_IMAGE_MODEL (np. gpt-image-1.5).` };
    return { ok: false, message: `OpenAI: ${b.error?.message ?? `HTTP ${res.status}`}` };
  } catch (e) {
    return { ok: false, message: `Brak połączenia z OpenAI: ${(e as Error).message}` };
  }
}
