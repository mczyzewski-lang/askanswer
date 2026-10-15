import { spawn } from "node:child_process";
import { env } from "./env";

export interface ProbeResult {
  duration: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  rotation: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  formatName: string;
}

export function run(cmd: string, args: string[], opts: { onStderr?: (line: string) => void; input?: Buffer } = {}): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d: Buffer) => out.push(d));
    p.stderr.on("data", (d: Buffer) => {
      const s = d.toString();
      err += s;
      if (err.length > 200_000) err = err.slice(-100_000);
      if (opts.onStderr) for (const line of s.split(/\r|\n/)) if (line.trim()) opts.onStderr(line);
    });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err });
      else reject(new Error(`${cmd} exited with ${code}: ${err.slice(-2000)}`));
    });
    if (opts.input) p.stdin.end(opts.input);
    else p.stdin.end();
  });
}

function parseRate(r?: string): number | null {
  if (!r) return null;
  const [a, b] = r.split("/").map(Number);
  if (!a || !b) return null;
  return a / b;
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run(env.ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  const data = JSON.parse(stdout.toString()) as {
    format: { duration?: string; format_name: string };
    streams: Array<{
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      duration?: string;
      tags?: Record<string, string>;
      side_data_list?: Array<{ rotation?: number }>;
    }>;
  };
  const v = data.streams.find((s) => s.codec_type === "video");
  const a = data.streams.find((s) => s.codec_type === "audio");
  let rotation = 0;
  if (v) {
    const sd = v.side_data_list?.find((x) => typeof x.rotation === "number");
    rotation = Number(sd?.rotation ?? v.tags?.rotate ?? 0) || 0;
  }
  let duration = Number(data.format.duration ?? v?.duration ?? a?.duration ?? 0);
  if (!Number.isFinite(duration)) duration = 0;
  let width = v?.width ?? null;
  let height = v?.height ?? null;
  if (Math.abs(rotation) % 180 === 90 && width && height) [width, height] = [height, width];
  return {
    duration,
    width,
    height,
    fps: parseRate(v?.avg_frame_rate) ?? parseRate(v?.r_frame_rate),
    rotation,
    hasVideo: !!v,
    hasAudio: !!a,
    videoCodec: v?.codec_name ?? null,
    audioCodec: a?.codec_name ?? null,
    formatName: data.format.format_name,
  };
}

/** Accurate duration by decoding (MediaRecorder WebM files often have no duration in the header). */
export async function decodeDuration(file: string): Promise<number> {
  const { stderr } = await run(env.ffmpeg, ["-hide_banner", "-i", file, "-map", "0", "-f", "null", "-"]);
  const m = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Normalize a browser recording into an edit-friendly master: H.264/AAC MP4, constant
 * 30 fps, rotation applied, max 1080×1920, keyframe every second (fast, accurate seeking).
 * The original upload is kept untouched next to it.
 */
export async function normalizeRecording(input: string, output: string, onProgress?: (p: number) => void, duration = 0): Promise<void> {
  await run(
    env.ffmpeg,
    [
      "-hide_banner",
      "-y",
      "-i",
      input,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-vf",
      "scale='if(gt(iw,ih),min(1920,iw),min(1080,iw))':-2:flags=lanczos,fps=30,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-g",
      "30",
      "-keyint_min",
      "30",
      "-sc_threshold",
      "0",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-af",
      "aresample=async=1:first_pts=0",
      "-movflags",
      "+faststart",
      output,
    ],
    {
      onStderr: (line) => {
        const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
        if (m && duration > 0 && onProgress) onProgress(Math.min(1, (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / duration));
      },
    },
  );
}

/**
 * Lightweight WebM (VP8/Opus) preview proxy, ≤960 px on the long side. Used by the
 * Studio preview in browsers without H.264 decoding; exports always use the master.
 */
export async function makePreviewProxy(input: string, output: string): Promise<void> {
  await run(env.ffmpeg, [
    "-hide_banner",
    "-y",
    "-i",
    input,
    "-vf",
    "scale='if(gt(iw,ih),min(960,iw),-2)':'if(gt(iw,ih),-2,min(960,ih))'",
    "-c:v",
    "libvpx",
    "-deadline",
    "realtime",
    "-cpu-used",
    "8",
    "-b:v",
    "1500k",
    "-g",
    "30",
    "-c:a",
    "libopus",
    "-b:a",
    "96k",
    output,
  ]);
}

/** Decode audio to mono float32 PCM for analysis. */
export async function decodePcm(input: string, sampleRate = 16000): Promise<Float32Array> {
  const { stdout } = await run(env.ffmpeg, ["-hide_banner", "-v", "error", "-i", input, "-vn", "-ac", "1", "-ar", String(sampleRate), "-f", "f32le", "-"]);
  return new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4));
}

/** Compact audio for transcription upload. */
export async function extractSpeechAudio(input: string, output: string): Promise<void> {
  await run(env.ffmpeg, ["-hide_banner", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "96k", output]);
}

/** FFmpeg's own silencedetect, used to cross-check our energy-based analysis. */
export async function ffmpegSilences(input: string, noiseDb = -35, minDur = 0.6): Promise<Array<[number, number]>> {
  const { stderr } = await run(env.ffmpeg, ["-hide_banner", "-i", input, "-vn", "-af", `silencedetect=noise=${noiseDb}dB:d=${minDur}`, "-f", "null", "-"]);
  const out: Array<[number, number]> = [];
  let start: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = /silence_start: (-?\d+(?:\.\d+)?)/.exec(line);
    if (s) start = Math.max(0, Number(s[1]));
    const e = /silence_end: (\d+(?:\.\d+)?)/.exec(line);
    if (e && start != null) {
      out.push([start, Number(e[1])]);
      start = null;
    }
  }
  return out;
}
