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
    p.on("close", (code, signal) => {
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err });
      else if (signal === "SIGKILL")
        reject(new Error(`${cmd} został przerwany przez system (SIGKILL) — najpewniej zabrakło pamięci RAM na serwerze. ${err.slice(-500)}`));
      else {
        // keep the lines that explain the failure, not the progress spam
        const lines = err.split(/\r|\n/).filter((l) => l.trim() && !/^\s*(frame=|size=)/.test(l));
        const reason = lines.filter((l) => /error|invalid|failed|could not|unable|cannot|not found|no such|killed/i.test(l)).slice(-5).join(" | ");
        reject(new Error(`${cmd} zakończył się kodem ${code ?? signal}${code === null || code === 137 ? " (proces przerwany — prawdopodobnie brak pamięci RAM)" : ""}: ${reason || lines.slice(-3).join(" | ")}`));
      }
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
/**
 * The size the recording has for most of its time. Browsers can change the camera resolution in the
 * middle of a recording (e.g. the first frames landscape 640×480, then portrait), and FFmpeg would
 * otherwise keep the first frame's size and stretch everything after it.
 */
export async function dominantFrameSize(file: string, duration = 0): Promise<{ width: number; height: number } | null> {
  const { stdout } = await run(env.ffprobe, ["-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey", "-show_entries", "frame=best_effort_timestamp_time,width,height,sample_aspect_ratio", "-of", "json", file]);
  const frames = (JSON.parse(stdout.toString()) as { frames?: Array<{ width?: number; height?: number; sample_aspect_ratio?: string; best_effort_timestamp_time?: string }> }).frames ?? [];
  const rows = frames
    .map((f) => {
      const sar = (f.sample_aspect_ratio ?? "").split(":").map(Number);
      const k = sar.length === 2 && sar[0] > 0 && sar[1] > 0 ? sar[0] / sar[1] : 1;
      return { w: Math.round((f.width ?? 0) * k), h: f.height ?? 0, t: Number(f.best_effort_timestamp_time) };
    })
    .filter((r) => r.w > 0 && r.h > 0);
  if (!rows.length) return null;
  const end = Math.max(duration, ...rows.map((r) => (Number.isFinite(r.t) ? r.t : 0)));
  const time = new Map<string, number>();
  rows.forEach((r, i) => {
    const t0 = Number.isFinite(r.t) ? r.t : i;
    const next = rows[i + 1];
    const t1 = next && Number.isFinite(next.t) ? next.t : Math.max(t0 + 1, end);
    const key = `${r.w}x${r.h}`;
    time.set(key, (time.get(key) ?? 0) + Math.max(0.001, t1 - t0));
  });
  const best = [...time.entries()].sort((a, b) => b[1] - a[1])[0][0].split("x").map(Number);
  return { width: best[0], height: best[1] };
}

/** Output size: the dominant frame size (rotation applied), max 1080 on the short side, even. */
export function normalizedSize(src: { width: number; height: number }, rotation = 0): { width: number; height: number } {
  let { width: w, height: h } = src;
  if (Math.abs(rotation) % 180 === 90) [w, h] = [h, w];
  const k = Math.min(1, (w > h ? 1920 : 1080) / w);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(w * k), height: even(h * k) };
}

export async function normalizeRecording(input: string, output: string, onProgress?: (p: number) => void, duration = 0, mirror = false): Promise<void> {
  // a fixed output size from the frames that make up most of the recording; frames of another size
  // (a resolution switch of the camera) are fitted in, never stretched
  let size: { width: number; height: number } | null = null;
  try {
    const dom = await dominantFrameSize(input, duration);
    if (dom) size = normalizedSize(dom, (await probe(input)).rotation);
  } catch {
    size = null;
  }
  const fit = size
    ? `scale='trunc(iw*sar/2)*2':ih,setsar=1,scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`
    : "scale='if(gt(iw,ih),min(1920,iw),min(1080,iw))':-2:flags=lanczos";
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
      `${mirror ? "hflip," : ""}${fit},fps=30,format=yuv420p`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-threads",
      process.env.FFMPEG_THREADS ?? "2",
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
    "-threads",
    process.env.FFMPEG_THREADS ?? "2",
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
