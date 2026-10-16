import path from "node:path";

function str(name: string, def = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? def : v;
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
    return str("ELEVENLABS_API_KEY");
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
    return str("OPENAI_API_KEY").trim().replace(/^["']|["']$/g, "");
  },
  get openaiBaseUrl() {
    return str("OPENAI_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, "");
  },
  get openaiImageModel() {
    return str("OPENAI_IMAGE_MODEL", "gpt-image-2");
  },
  get anthropicConfigured() {
    return Boolean(str("ANTHROPIC_API_KEY") || str("ANTHROPIC_AUTH_TOKEN"));
  },
  get claudeModel() {
    return str("CLAUDE_MODEL", "claude-opus-5-5");
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

export function openaiConfigured(): boolean {
  return env.openaiKey.length >= 20;
}
