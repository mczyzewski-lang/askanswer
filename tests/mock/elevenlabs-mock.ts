/**
 * MOCK ElevenLabs API — for automated tests only (the real API is not reachable
 * from CI/sandboxes). It implements the endpoints AskBy Studio calls, with the
 * same request/response shapes:
 *   GET  /v1/voices
 *   POST /v1/text-to-speech/:voiceId   → MP3 test tone (length ∝ text length)
 *   POST /v1/speech-to-text            → word timestamps placed on the real voiced
 *                                        regions of the uploaded audio
 * Words are placeholders ("słowo1", …) — clearly not a real transcription.
 */
import http from "node:http";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const ff = process.env.FFMPEG_PATH || "ffmpeg";
let ttsCalls = 0;
let sttCalls = 0;

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function tone(seconds: number): Buffer {
  const f = path.join(os.tmpdir(), `mock-tts-${process.pid}-${Date.now()}.mp3`);
  execFileSync(ff, ["-v", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=523:sample_rate=44100:duration=${seconds.toFixed(2)}`, "-af", "volume=0.4", "-c:a", "libmp3lame", "-b:a", "64k", f]);
  const b = fs.readFileSync(f);
  fs.rmSync(f, { force: true });
  return b;
}

function voicedRegions(audio: Buffer): Array<[number, number]> {
  const f = path.join(os.tmpdir(), `mock-stt-${process.pid}-${Date.now()}`);
  fs.writeFileSync(f, audio);
  const pcm = execFileSync(ff, ["-v", "error", "-i", f, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  fs.rmSync(f, { force: true });
  const s = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4));
  const win = 160;
  const regions: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i * win < s.length; i++) {
    let sq = 0;
    for (let k = i * win; k < Math.min(s.length, (i + 1) * win); k++) sq += s[k] * s[k];
    const db = 20 * Math.log10(Math.sqrt(sq / win) + 1e-9);
    const t = i / 100;
    if (db > -35 && start < 0) start = t;
    if (db <= -35 && start >= 0) {
      if (t - start > 0.15) regions.push([start, t]);
      start = -1;
    }
  }
  if (start >= 0) regions.push([start, s.length / 16000]);
  // merge tiny gaps (syllable modulation)
  const merged: Array<[number, number]> = [];
  for (const r of regions) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] < 0.25) last[1] = r[1];
    else merged.push([...r]);
  }
  return merged;
}

const hfRequests = new Map<string, { polls: number; prompt: string }>();
let hfClip: Buffer | null = null;
async function higgsfield(req: http.IncomingMessage, res: http.ServerResponse, p: string, json: (c: number, d: unknown) => void) {
  if (p.startsWith("/files/")) {
    // a 9:16 colour-bars clip standing in for the generated video
    hfClip ??= (() => {
      const f = path.join(os.tmpdir(), `mock-hf-${process.pid}.mp4`);
      execFileSync(ff, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=30:duration=5", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", f]);
      return fs.readFileSync(f);
    })();
    res.writeHead(200, { "content-type": "video/mp4" });
    return res.end(hfClip);
  }
  if (!/^Key [^:\s]+:\S+$/.test(String(req.headers.authorization ?? ""))) return json(401, { detail: "Invalid credentials" });
  const m = p.match(/^\/requests\/([\w-]+)\/status$/);
  if (req.method === "GET" && m) {
    const r = hfRequests.get(m[1]);
    if (!r) return json(404, { detail: "not found" });
    r.polls++;
    const base = { request_id: m[1], status_url: `http://127.0.0.1:${PORT}/hf/requests/${m[1]}/status` };
    if (r.polls < 2) return json(200, { ...base, status: "in_progress" });
    return json(200, { ...base, status: "completed", video: { url: `http://127.0.0.1:${PORT}/hf/files/${m[1]}.mp4` } });
  }
  if (req.method === "POST" && p.endsWith("/text-to-video")) {
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    if (!body.prompt || !body.aspect_ratio || !body.duration) return json(422, { detail: "prompt, duration and aspect_ratio are required" });
    const id = `mock-${Date.now().toString(36)}-${hfRequests.size}`;
    hfRequests.set(id, { polls: 0, prompt: body.prompt });
    return json(200, { status: "queued", request_id: id, status_url: `http://127.0.0.1:${PORT}/hf/requests/${id}/status` });
  }
  return json(404, { detail: "unknown endpoint" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const json = (code: number, data: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  };
  try {
    // ---- MOCK Higgsfield (text-to-video): POST /{model} → request_id; GET /requests/:id/status ----
    if (url.pathname.startsWith("/hf/")) return higgsfield(req, res, url.pathname.slice(3), json);
    if (!req.headers["xi-api-key"]) return json(401, { detail: "missing api key" });
    if (req.method === "GET" && url.pathname === "/v1/voices") {
      return json(200, { voices: [{ voice_id: "mock-voice-pl", name: "Mock — Polski lektor", labels: { accent: "polish", gender: "female" } }, { voice_id: "mock-voice-2", name: "Mock — Drugi głos", labels: {} }] });
    }
    if (req.method === "GET" && url.pathname === "/__stats") return json(200, { ttsCalls, sttCalls });
    if (req.method === "POST" && url.pathname.startsWith("/v1/text-to-speech/")) {
      const body = JSON.parse((await readBody(req)).toString());
      ttsCalls++;
      const seconds = Math.min(6, Math.max(1.2, String(body.text ?? "").length / 16));
      res.writeHead(200, { "content-type": "audio/mpeg" });
      return res.end(tone(seconds));
    }
    if (req.method === "POST" && url.pathname === "/v1/audio-isolation") {
      // mock: returns the uploaded audio re-encoded (real API removes noise/echo)
      const raw = await readBody(req);
      const request = new Request("http://x", { method: "POST", headers: { "content-type": String(req.headers["content-type"]) }, body: new Uint8Array(raw) });
      const file = (await request.formData()).get("audio") as File | null;
      if (!file) return json(400, { detail: "audio required" });
      const f = path.join(os.tmpdir(), `mock-iso-${Date.now()}`);
      fs.writeFileSync(f, Buffer.from(await file.arrayBuffer()));
      const out = execFileSync(ff, ["-v", "error", "-i", f, "-f", "mp3", "-"], { maxBuffer: 1 << 30 });
      fs.rmSync(f, { force: true });
      res.writeHead(200, { "content-type": "audio/mpeg" });
      return res.end(out);
    }
    if (req.method === "POST" && url.pathname === "/v1/speech-to-text") {
      sttCalls++;
      const raw = await readBody(req);
      const request = new Request("http://x", { method: "POST", headers: { "content-type": String(req.headers["content-type"]) }, body: new Uint8Array(raw) });
      const form = await request.formData();
      const file = form.get("file") as File | null;
      if (!file) return json(400, { detail: "file required" });
      if (form.get("timestamps_granularity") !== "word") return json(400, { detail: "word timestamps expected" });
      const regions = voicedRegions(Buffer.from(await file.arrayBuffer()));
      const words: Array<{ text: string; start: number; end: number; type: string; logprob: number }> = [];
      let n = 0;
      for (const [a, b] of regions) {
        for (let t = a; t < b - 0.1; t += 0.42) {
          n++;
          const end = Math.min(b, t + 0.36);
          const last = end >= b - 0.1 || t + 0.42 >= b - 0.1;
          if (words.length) words.push({ text: " ", start: words[words.length - 1].end, end: t, type: "spacing", logprob: 0 });
          words.push({ text: `słowo${n}${last ? "." : ""}`, start: Math.round(t * 1000) / 1000, end: Math.round(end * 1000) / 1000, type: "word", logprob: -0.1 });
        }
      }
      return json(200, { language_code: "pol", language_probability: 0.99, text: words.filter((w) => w.type === "word").map((w) => w.text).join(" "), words });
    }
    json(404, { detail: "not found" });
  } catch (e) {
    json(500, { detail: (e as Error).message });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`[mock-elevenlabs] listening on ${PORT}`));
