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
import crypto from "node:crypto";
import type { Duplex } from "node:stream";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const ff = process.env.FFMPEG_PATH || "ffmpeg";
let ttsCalls = 0;
const oaiLog: Array<{ model: string; size: string; prompt: string; n: number }> = [];
const ttsLog: Array<{ voiceId: string; model: string; text: string; settings: unknown }> = [];
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
  const levels: number[] = [];
  for (let i = 0; i * win < s.length; i++) {
    let sq = 0;
    for (let k = i * win; k < Math.min(s.length, (i + 1) * win); k++) sq += s[k] * s[k];
    levels.push(20 * Math.log10(Math.sqrt(sq / win) + 1e-9));
  }
  // relative threshold: Chrome's mic auto-gain makes later takes quieter than the fixture
  const loud = [...levels].sort((a, b) => b - a)[Math.floor(levels.length * 0.1)] ?? -20;
  const threshold = Math.max(-55, Math.min(-35, loud - 25));
  for (let i = 0; i < levels.length; i++) {
    const db = levels[i];
    const t = i / 100;
    if (db > threshold && start < 0) start = t;
    if (db <= threshold && start >= 0) {
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

const hfRequests = new Map<string, { polls: number; prompt: string; image: boolean }>();
let hfClip: Buffer | null = null;
async function higgsfield(req: http.IncomingMessage, res: http.ServerResponse, p: string, json: (c: number, d: unknown) => void) {
  if (p.startsWith("/files/") && p.endsWith(".png")) {
    const f = path.join(os.tmpdir(), `mock-hf-${process.pid}.png`);
    if (!fs.existsSync(f)) execFileSync(ff, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=720x1280", "-frames:v", "1", f]);
    res.writeHead(200, { "content-type": "image/png" });
    return res.end(fs.readFileSync(f));
  }
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
  if (!/^Key \S{8,}$/.test(String(req.headers.authorization ?? ""))) return json(401, { detail: "Invalid credentials" });
  const m = p.match(/^\/requests\/([\w-]+)\/status$/);
  if (req.method === "GET" && m) {
    const r = hfRequests.get(m[1]);
    if (!r) return json(404, { detail: "not found" });
    r.polls++;
    const base = { request_id: m[1], status_url: `http://127.0.0.1:${PORT}/hf/requests/${m[1]}/status` };
    if (r.polls < 2) return json(200, { ...base, status: "in_progress" });
    if (r.image) return json(200, { ...base, status: "completed", images: [{ url: `http://127.0.0.1:${PORT}/hf/files/${m[1]}.png` }] });
    return json(200, { ...base, status: "completed", video: { url: `http://127.0.0.1:${PORT}/hf/files/${m[1]}.mp4` } });
  }
  if (req.method === "POST" && p.endsWith("/text-to-image")) {
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    if (!body.prompt || !body.aspect_ratio) return json(422, { detail: "prompt and aspect_ratio are required" });
    const id = `mock-img-${Date.now().toString(36)}-${hfRequests.size}`;
    hfRequests.set(id, { polls: 0, prompt: body.prompt, image: true });
    return json(200, { status: "queued", request_id: id });
  }
  if (req.method === "POST" && p.endsWith("/text-to-video")) {
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    if (!body.prompt || !body.aspect_ratio || !body.duration) return json(422, { detail: "prompt, duration and aspect_ratio are required" });
    const id = `mock-${Date.now().toString(36)}-${hfRequests.size}`;
    hfRequests.set(id, { polls: 0, prompt: body.prompt, image: false });
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
    // ---- MOCK OpenAI images: POST /oai/v1/images/generations → base64 PNG; GET /oai/v1/models/:id ----
    if (url.pathname.startsWith("/oai/")) {
      if (!/^Bearer \S{20,}$/.test(String(req.headers.authorization ?? ""))) return json(401, { error: { message: "Incorrect API key provided" } });
      if (req.method === "GET" && url.pathname.startsWith("/oai/v1/models/")) return json(200, { id: decodeURIComponent(url.pathname.split("/").pop() ?? ""), object: "model" });
      if (req.method === "POST" && url.pathname === "/oai/v1/images/generations") {
        const body = JSON.parse((await readBody(req)).toString() || "{}");
        const m = /^(\d+)x(\d+)$/.exec(String(body.size));
        if (!body.model || !body.prompt || !m || +m[1] % 16 || +m[2] % 16) return json(400, { error: { message: "invalid model/prompt/size" } });
        oaiLog.push({ model: body.model, size: body.size, prompt: body.prompt, n: body.n ?? 1 });
        const f = path.join(os.tmpdir(), `mock-oai-${process.pid}-${m[1]}x${m[2]}.png`);
        if (!fs.existsSync(f)) execFileSync(ff, ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=size=${m[1]}x${m[2]}`, "-frames:v", "1", f]);
        const n = Math.max(1, Math.min(10, Number(body.n ?? 1)));
        return json(200, { created: Math.floor(Date.now() / 1000), data: Array.from({ length: n }, () => ({ b64_json: fs.readFileSync(f).toString("base64") })) });
      }
      if (req.method === "POST" && url.pathname === "/oai/v1/chat/completions") {
        const body = JSON.parse((await readBody(req)).toString() || "{}");
        const user = String(body.messages?.find((m: { role: string }) => m.role === "user")?.content ?? "");
        oaiLog.push({ model: body.model, size: "", prompt: String(body.messages?.[0]?.content ?? "").slice(0, 400) + "\n---\n" + user, n: 1 });
        const hook = /\[HOOK\] (.*)/.exec(user)?.[1] ?? "";
        const review = {
          score: 54,
          verdict: "Hook ogólny, brak stawki w pierwszych sekundach.",
          diagnosis: null,
          criteria: ["HOOK 0–2 s", "NAPIĘCIE 2–6 s", "RETENCJA / TEMPO", "PAYOFF", "SHAREABILITY", "CTA", "AUTENTYCZNOŚĆ", "DOPASOWANIE DO KLIENTA I OFERTY"].map((name, i) => ({ name, score: 4 + (i % 4), why: `Uzasadnienie ${i + 1}.` })),
          redFlags: ["Obietnica wyniku: „pozbędziesz się długów”"],
          levers: ["Konkretny lęk w hooku", "Stawka w 2–6 s", "CTA do wysłania komuś"],
          newVersion: {
            onScreen: "Komornik zabrał Ci pensję?",
            timeline: [{ time: "0–2 s", text: "Komornik zabrał Ci pensję?" }, { time: "2–6 s", text: "Nie wszystko może zabrać." }, { time: "6–20 s", text: "Część zostaje zawsze." }, { time: "koniec", text: "Wyślij to komuś." }],
            hook: `Nowy hook: ${hook.slice(0, 20)}`,
            body: "Nowe body z propozycji.",
            cta: "Wyślij to komuś, kto ma komornika.",
            shots: ["Zbliżenie na pismo od komornika"],
            caption: "Co komornik może zabrać? Napisz PENSJA w wiadomości.",
          },
          altHooks: [{ mechanism: "lęk", text: "Alternatywny hook lęk" }, { mechanism: "liczba", text: "Alternatywny hook liczba" }, { mechanism: "kontrowersja", text: "Alternatywny hook kontrowersja" }],
          predicted: { score: 78, limits: "Brak liczby w payoffie." },
          compliance: ["Unikaj „pozbędziesz się długów”."],
        };
        return json(200, { id: "chatcmpl-mock", object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(review) }, finish_reason: "stop" }] });
      }
      return json(404, { error: { message: "unknown endpoint" } });
    }
    if (!req.headers["xi-api-key"]) return json(401, { detail: "missing api key" });
    if (req.method === "POST" && url.pathname === "/v1/single-use-token/realtime_scribe") {
      return json(200, { token: `mock-rt-${Date.now().toString(36)}` });
    }
    if (req.method === "GET" && url.pathname === "/v1/voices") {
      return json(200, { voices: [{ voice_id: "mock-voice-pl", name: "Mock — Polski lektor", labels: { accent: "polish", gender: "female" } }, { voice_id: "mock-voice-2", name: "Mock — Drugi głos", labels: {} }] });
    }
    if (req.method === "GET" && url.pathname === "/__stats") return json(200, { ttsCalls, sttCalls, tts: ttsLog.slice(-50), openai: oaiLog.slice(-20) });
    if (req.method === "POST" && url.pathname.startsWith("/v1/text-to-speech/")) {
      const body = JSON.parse((await readBody(req)).toString());
      ttsCalls++;
      ttsLog.push({ voiceId: decodeURIComponent(url.pathname.split("/").pop() ?? ""), model: body.model_id, text: body.text, settings: body.voice_settings });
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

// ---- MOCK Scribe v2 Realtime (WebSocket) ----
// "Speaks" a fixed sentence while audio chunks arrive: one word per audio message, committed every
// 6 words. It contains a filler ad-lib and skips a whole sentence of the test script, so the e2e test
// proves the prompter follows real speech, not a timer.
export const MOCK_SPEECH =
  "Trzy błędy które kosztują Cię klientów eee tak myślę że pierwszy błąd to brak odpowiedzi w ciągu dwudziestu czterech godzin trzeci błąd to brak follow-upu po spotkaniu z klientem";
function wsSend(socket: Duplex, data: unknown) {
  const payload = Buffer.from(JSON.stringify(data));
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x81, len]) : len < 65536 ? Buffer.from([0x81, 126, len >> 8, len & 255]) : (() => {
    const b = Buffer.alloc(10);
    b[0] = 0x81;
    b[1] = 127;
    b.writeBigUInt64BE(BigInt(len), 2);
    return b;
  })();
  socket.write(Buffer.concat([head, payload]));
}
server.on("upgrade", (req, socket) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname !== "/v1/speech-to-text/realtime" || !url.searchParams.get("token") || url.searchParams.get("model_id") !== "scribe_v2_realtime") {
    socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return;
  }
  const accept = crypto.createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  // like the real service, the session starts listening only after a moment
  let started = false;
  setTimeout(() => {
    started = true;
    wsSend(socket, { message_type: "session_started", session_id: "mock" });
  }, Number(process.env.MOCK_RT_START_MS ?? 1500));
  const words = MOCK_SPEECH.split(" ");
  let spoken = 0;
  let committedAt = 0;
  let buf = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 0x0f;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      const masked = (buf[1] & 0x80) !== 0;
      const total = off + (masked ? 4 : 0) + len;
      if (buf.length < total) return;
      const mask = masked ? buf.subarray(off, off + 4) : null;
      const data = Buffer.from(buf.subarray(off + (masked ? 4 : 0), total));
      if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
      buf = buf.subarray(total);
      if (op === 0x8) {
        socket.end();
        return;
      }
      if (op !== 0x1) continue;
      let msg: { message_type?: string; audio_base_64?: string; sample_rate?: number };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        continue;
      }
      if (msg.message_type !== "input_audio_chunk" || !msg.audio_base_64 || msg.sample_rate !== 16000) continue;
      if (!started) continue; // audio before the session started is not transcribed
      if (spoken >= words.length) continue;
      spoken++;
      if (spoken - committedAt >= 6 || spoken === words.length) {
        wsSend(socket, { message_type: "committed_transcript", text: words.slice(committedAt, spoken).join(" ") });
        committedAt = spoken;
      } else {
        wsSend(socket, { message_type: "partial_transcript", text: words.slice(committedAt, spoken).join(" ") });
      }
    }
  });
  socket.on("error", () => {});
});

server.listen(PORT, "127.0.0.1", () => console.log(`[mock-elevenlabs] listening on ${PORT}`));
