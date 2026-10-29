import path from "node:path";

function str(name: string, def = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? def : v;
}

/**
 * API keys as pasted into Railway: tolerate a copied `NAME=` prefix, surrounding quotes,
 * "Bearer " and stray spaces/new lines (a key never contains any of these).
 */
export function cleanSecret(raw: string, name = ""): string {
  let v = raw.trim();
  if (name && v.toUpperCase().startsWith(`${name.toUpperCase()}=`)) v = v.slice(name.length + 1).trim();
  v = v.replace(/^["'`]+|["'`;]+$/g, "").trim();
  v = v.replace(/^(Bearer|Key)\s+/i, "");
  return v.replace(/\s+/g, "");
}

export const env = {
  get databaseUrl() {
    return str("DATABASE_URL");
  },
  get appUrl() {
    return str("APP_URL", "http://localhost:3000").replace(/\/$/, "");
  },
  get appSecret() {
    const s = str("APP_SECRET");
    if (s.length < 32) {
      if (process.env.NODE_ENV === "production") throw new Error("APP_SECRET must be at least 32 characters");
      return "insecure-development-secret-change-me-please-0123456789";
    }
    return s;
  },
  get elevenLabsKey() {
    return cleanSecret(str("ELEVENLABS_API_KEY"), "ELEVENLABS_API_KEY");
  },
  get elevenLabsBaseUrl() {
    return str("ELEVENLABS_BASE_URL", "https://api.elevenlabs.io").replace(/\/$/, "");
  },
  get defaultVoiceId() {
    return str("ELEVENLABS_VOICE_ID", "pNInz6obpgDQGcFmaJgB");
  },
  get ttsModel() {
    return str("ELEVENLABS_TTS_MODEL", "eleven_v4");
  },
  get realtimeSttModel() {
    return str("ELEVENLABS_REALTIME_STT_MODEL", "scribe_v2_realtime");
  },
  get sttModel() {
    return str("ELEVENLABS_STT_MODEL", "scribe_v2");
  },
  /** Higgsfield API credentials in the form KEY_ID:KEY_SECRET. */
  /** "KEY_ID:KEY_SECRET", or a single API key; pasted prefixes/quotes/spaces are tolerated. */
  get higgsfieldCredentials() {
    const clean = (v: string) => v.trim().replace(/^["']|["']$/g, "").replace(/^(Key|Bearer)\s+/i, "").replace(/\s+/g, "");
    const both = clean(str("HIGGSFIELD_CREDENTIALS") || str("HF_CREDENTIALS") || str("HF_KEY"));
    if (both) return both;
    const id = clean(str("HIGGSFIELD_API_KEY") || str("HF_API_KEY"));
    const secret = clean(str("HIGGSFIELD_API_SECRET") || str("HF_API_SECRET"));
    return id && secret ? `${id}:${secret}` : id;
  },
  get higgsfieldBaseUrl() {
    return str("HIGGSFIELD_BASE_URL", "https://api.higgsfield.ai").replace(/\/$/, "");
  },
  get higgsfieldModel() {
    return str("HIGGSFIELD_MODEL", "kling-video/v3.0/pro/text-to-video");
  },
  get openaiKey() {
    const direct = cleanSecret(str("OPENAI_API_KEY"), "OPENAI_API_KEY");
    if (direct) return direct;
    // the same key under a slightly different name (OPENAI_KEY, OPEN_AI_API_KEY, a name with a stray space…)
    const alt = openaiEnvNames().find((n) => n !== "OPENAI_API_KEY");
    return alt ? cleanSecret(process.env[alt] ?? "", alt.trim()) : "";
  },
  get openaiBaseUrl() {
    return str("OPENAI_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, "");
  },
  /** "medium" (default) | "high" | "low" — the biggest factor of the cost per image (high ≈ 4× medium) */
  get openaiImageQuality(): "low" | "medium" | "high" {
    const q = str("OPENAI_IMAGE_QUALITY", "medium");
    return q === "low" || q === "high" ? q : "medium";
  },
  /** long side of generated images in px (gpt-image-2), default 1536 */
  get openaiImageLong() {
    return Number(str("OPENAI_IMAGE_LONG", "1536")) || 1536;
  },
  /** variants drawn for each illustration (to choose from in the Studio), 1–4 */
  get illustrationVariants() {
    return Math.max(1, Math.min(4, Number(str("ILLUSTRATION_VARIANTS", "3")) || 3));
  },
  /** text model for script reviews (Ads Studio scoring) */
  get openaiTextModel() {
    return str("OPENAI_TEXT_MODEL", "gpt-5");
  },
  get openaiImageModel() {
    return str("OPENAI_IMAGE_MODEL", "gpt-image-2");
  },
  get anthropicKey() {
    return cleanSecret(str("ANTHROPIC_API_KEY"), "ANTHROPIC_API_KEY");
  },
  get anthropicConfigured() {
    return Boolean(this.anthropicKey || str("ANTHROPIC_AUTH_TOKEN"));
  },
  get claudeModel() {
    return str("CLAUDE_MODEL", "claude-opus-5-5");
  },
  /** Upload-Post (Social Media Studio). Without a key the studio runs in DEMO mode (mock provider). */
  get uploadPostKey() {
    return cleanSecret(str("UPLOAD_POST_API_KEY"), "UPLOAD_POST_API_KEY");
  },
  get uploadPostBaseUrl() {
    return str("UPLOAD_POST_BASE_URL", "https://api.upload-post.com/api").replace(/\/$/, "");
  },
  /** shared secret for the webhook signature (HMAC SHA-256), if the provider signs deliveries */
  get uploadPostWebhookSecret() {
    return cleanSecret(str("UPLOAD_POST_WEBHOOK_SECRET"), "UPLOAD_POST_WEBHOOK_SECRET");
  },
  /** secret token in the webhook URL (?token=…) — second factor, and the only one if deliveries are unsigned */
  get uploadPostWebhookToken() {
    return cleanSecret(str("UPLOAD_POST_WEBHOOK_TOKEN"), "UPLOAD_POST_WEBHOOK_TOKEN");
  },
  get uploadPostSignatureHeader() {
    return str("UPLOAD_POST_SIGNATURE_HEADER", "x-upload-post-signature").toLowerCase();
  },
  get uploadPostTimestampHeader() {
    return str("UPLOAD_POST_TIMESTAMP_HEADER", "x-upload-post-timestamp").toLowerCase();
  },
  get uploadPostDeliveryHeader() {
    return str("UPLOAD_POST_DELIVERY_HEADER", "x-upload-post-delivery").toLowerCase();
  },
  /** send our stable external_id with every order (not confirmed in the provider's public SDK — off by default) */
  get uploadPostSendExternalId() {
    return str("UPLOAD_POST_SEND_EXTERNAL_ID", "false") === "true";
  },
  /** force DEMO mode even with a key (e.g. a staging environment) */
  get socialDemoForced() {
    return str("SOCIAL_DEMO_MODE", "false") === "true";
  },
  get storageDriver(): "local" | "s3" {
    return str("STORAGE_DRIVER", "local") === "s3" ? "s3" : "local";
  },
  get storageDir() {
    return path.resolve(str("STORAGE_LOCAL_DIR", "./storage"));
  },
  get ffmpeg() {
    return str("FFMPEG_PATH", "ffmpeg");
  },
  get ffprobe() {
    return str("FFPROBE_PATH", "ffprobe");
  },
  get maxUploadBytes() {
    return Number(str("MAX_UPLOAD_MB", "1024")) * 1024 * 1024;
  },
  get invitationTtlDays() {
    return Number(str("INVITATION_TTL_DAYS", "30"));
  },
  s3: {
    get endpoint() {
      return str("S3_ENDPOINT");
    },
    get region() {
      return str("S3_REGION", "us-east-1");
    },
    get bucket() {
      return str("S3_BUCKET", "askby-media");
    },
    get accessKeyId() {
      return str("S3_ACCESS_KEY_ID");
    },
    get secretAccessKey() {
      return str("S3_SECRET_ACCESS_KEY");
    },
    get forcePathStyle() {
      return str("S3_FORCE_PATH_STYLE", "true") === "true";
    },
  },
};

export function elevenLabsConfigured(): boolean {
  return env.elevenLabsKey.length > 0;
}

export function higgsfieldConfigured(): boolean {
  return env.higgsfieldCredentials.length >= 8;
}

/** Social Media Studio talks to the real Upload-Post API only with a key and without SOCIAL_DEMO_MODE. */
export function uploadPostLive(): boolean {
  return env.uploadPostKey.length >= 8 && !env.socialDemoForced;
}

export function openaiConfigured(): boolean {
  return env.openaiKey.length >= 20;
}

/** Names of environment variables that look like an OpenAI key (names only — never the values). */
export function openaiEnvNames(): string[] {
  return Object.keys(process.env).filter((n) => /open[\s_-]*ai/i.test(n) && /(key|token|secret)/i.test(n) && (process.env[n] ?? "").trim() !== "");
}

/** What the server sees, for "Sprawdź połączenia" — safe to show: variable names and the key's length only. */
export function openaiKeyDiagnostics(): string {
  const names = openaiEnvNames();
  const key = env.openaiKey;
  if (!names.length) {
    const exists = "OPENAI_API_KEY" in process.env;
    return exists
      ? "Serwer widzi zmienną OPENAI_API_KEY, ale jest PUSTA — wklej w Railway samą wartość klucza (sk-…)."
      : "Serwer w ogóle nie widzi zmiennej OPENAI_API_KEY. Sprawdź w Railway, czy jest dodana w Variables TEJ usługi (nie tylko jako Shared Variable projektu i nie w innym środowisku) i czy po dodaniu nastąpiło ponowne wdrożenie (Deploy).";
  }
  const prefix = key.startsWith("sk-") ? "zaczyna się od „sk-”" : "NIE zaczyna się od „sk-”";
  return `Serwer widzi: ${names.map((n) => JSON.stringify(n)).join(", ")}; klucz po oczyszczeniu ma ${key.length} znaków i ${prefix}.${key.length < 20 ? " To za krótko — klucze OpenAI mają zwykle ponad 50 znaków." : ""}`;
}
