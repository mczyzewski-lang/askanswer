import fsp from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { env, elevenLabsConfigured, openaiConfigured } from "./env";
import { diskFullMessage, makeTempDir, putFile, toLocalFile } from "./storage";
import { extractSpeechAudio, makePreviewProxy, probe, run } from "./ffmpeg";
import { transcribe } from "./elevenlabs";
import { assembleChunks, readHead, sniffVideo } from "./chunked";
import { openaiErrorText } from "./reel-review";
import { EDU_QUALITY, exportFilter, keepRanges, keptDuration, transcriptSegments, wordGaps, type EduCut, type EduCutKind, type EduQuality, type EduResolution, type EduWord } from "../edu";

const step = (id: string, s: string) => prisma.eduVideo.update({ where: { id }, data: { step: s } });

/**
 * Worker "edu-process": assemble the upload, a light preview for the page, the transcript, the pauses
 * between words and the AI's proposed cuts (remarks for the editor, retakes, talk off the recording).
 */
export async function processEdu(eduId: string, totalChunks: number) {
  const e = await prisma.eduVideo.findUniqueOrThrow({ where: { id: eduId } });
  const work = await makeTempDir(`edu-${eduId}`);
  try {
    let originalId = e.originalAssetId;
    if (!originalId) {
      await step(eduId, "Składanie pliku");
      const a = await assembleChunks("uploads", e.uploadSessionId!, totalChunks);
      const { head, size } = await readHead(a.file);
      const kind = sniffVideo(head);
      if (!kind) throw new Error("To nie jest plik wideo (MP4 / MOV / WEBM)");
      const key = `edu/${eduId}/original.${kind.ext}`;
      await putFile(key, a.file, kind.mime);
      await fsp.rm(a.dir, { recursive: true, force: true });
      originalId = (await prisma.mediaAsset.create({ data: { kind: "RECORDING_ORIGINAL", storageKey: key, mimeType: kind.mime, sizeBytes: size, hasVideo: true, originalName: e.name } })).id;
      await prisma.eduVideo.update({ where: { id: eduId }, data: { originalAssetId: originalId, sizeBytes: BigInt(size) } });
      await prisma.uploadSession.update({ where: { id: e.uploadSessionId! }, data: { status: "DONE", assetId: originalId } }).catch(() => {});
    }
    const original = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: originalId } });
    const src = await toLocalFile(original.storageKey);
    try {
      const info = await probe(src.path);
      if (!info.hasVideo) throw new Error("Plik nie zawiera obrazu");
      await prisma.mediaAsset.update({ where: { id: originalId }, data: { durationSec: info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio } });
      await prisma.eduVideo.update({ where: { id: eduId }, data: { durationSec: info.duration, width: info.width, height: info.height } });

      await step(eduId, "Podgląd do przeglądania");
      const proxy = path.join(work, "proxy.webm");
      await makePreviewProxy(src.path, proxy);
      const pKey = `edu/${eduId}/proxy.webm`;
      const pSize = await putFile(pKey, proxy, "video/webm");
      const pa = await prisma.mediaAsset.upsert({ where: { storageKey: pKey }, create: { kind: "PREVIEW_PROXY", storageKey: pKey, mimeType: "video/webm", sizeBytes: pSize, durationSec: info.duration, hasAudio: info.hasAudio, hasVideo: true }, update: { sizeBytes: pSize } });
      await prisma.eduVideo.update({ where: { id: eduId }, data: { proxyAssetId: pa.id } });

      let words: EduWord[] = [];
      if (info.hasAudio) {
        await step(eduId, "Transkrypcja ElevenLabs");
        if (!elevenLabsConfigured()) throw new Error("Transkrypcja wymaga klucza ELEVENLABS_API_KEY.");
        const mp3 = path.join(work, "speech.mp3");
        await extractSpeechAudio(src.path, mp3);
        const r = await transcribe(mp3, { language: "pol" });
        words = r.words.filter((w) => (w.type ?? "word") === "word" && w.text.trim()).map((w) => ({ text: w.text.trim(), start: w.start, end: w.end }));
      }
      const pauses = wordGaps(words, info.duration);
      await prisma.eduVideo.update({ where: { id: eduId }, data: { words: words as unknown as Prisma.InputJsonValue, pauses: pauses as unknown as Prisma.InputJsonValue } });

      await step(eduId, "Analiza treści (AI)");
      const { cuts, summary } = words.length && openaiConfigured() ? await analyzeEdu(words) : { cuts: [], summary: words.length ? "Analiza AI wymaga klucza OPENAI_API_KEY — zostały tylko przerwy." : "Brak mowy w nagraniu." };
      await prisma.eduVideo.update({ where: { id: eduId }, data: { cuts: cuts as unknown as Prisma.InputJsonValue, summary, status: "READY", step: "Gotowe do przeglądu", error: null } });
    } finally {
      await src.cleanup();
    }
  } catch (err) {
    await prisma.eduVideo.update({ where: { id: eduId }, data: { status: "FAILED", error: (diskFullMessage(err) ?? (err as Error).message).slice(0, 1000) } });
    throw err;
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}

export const EDU_SYSTEM = `EDU_ANALYSIS
Jesteś montażystą materiałów edukacyjnych (kursy online, webinary, nagrania szkoleniowe). Dostajesz transkrypcję podzieloną na ponumerowane zdania z czasem. Wskaż fragmenty, które NIE powinny trafić do gotowego filmu:
- "editor": wypowiedzi do montażysty albo o montażu: „to wytnij”, „tu wstaw slajd / grafikę”, „zacznę jeszcze raz”, „od nowa”, „pauza”, „montażysta…”, „tego nie bierz”.
- "retake": nieudane podejścia — zdanie przerwane, pomylone albo za chwilę powiedziane jeszcze raz, lepiej. Wytnij wcześniejsze podejście, zostaw ostatnie dobre.
- "offtopic": rozmowy poza nagraniem i sprawy techniczne: „czy nagrywa?”, „dobra, możemy”, „chwila, napiję się”, rozmowa z kimś obok.
Nie wycinaj treści merytorycznej, przykładów ani dygresji na temat. Gdy nie masz pewności — nie wycinaj.
Odpowiedz wyłącznie JSON: {"summary": "1–2 zdania: o czym jest wideo", "cuts": [{"from": numer pierwszego zdania, "to": numer ostatniego zdania, "kind": "editor" | "retake" | "offtopic", "reason": "krótko, po polsku"}]}`;

async function chat(model: string, user: string) {
  return fetch(`${env.openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, response_format: { type: "json_object" }, messages: [{ role: "system", content: EDU_SYSTEM }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(240_000),
  });
}

/** The AI's proposed cuts, by sentence; long lectures go in windows of 300 sentences. */
export async function analyzeEdu(words: EduWord[]): Promise<{ cuts: EduCut[]; summary: string }> {
  const segs = transcriptSegments(words);
  const cuts: EduCut[] = [];
  const summaries: string[] = [];
  const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
  for (let i = 0; i < segs.length; i += 300) {
    const win = segs.slice(i, i + 300);
    const user = win.map((s) => `${s.id} [${fmt(s.start)}–${fmt(s.end)}] ${s.text}`).join("\n");
    let model = env.openaiTextModel;
    let res = await chat(model, user);
    if ((res.status === 400 || res.status === 404) && /model/i.test(JSON.stringify(await res.clone().json().catch(() => ({})))) && model !== "gpt-4.1") res = await chat((model = "gpt-4.1"), user);
    const data = (await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string; code?: string } };
    if (!res.ok) throw new Error(openaiErrorText(res.status, data));
    let parsed: { summary?: unknown; cuts?: Array<{ from?: unknown; to?: unknown; kind?: unknown; reason?: unknown }> } = {};
    try {
      parsed = JSON.parse((data.choices?.[0]?.message?.content ?? "{}").replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      throw new Error("OpenAI zwrócił odpowiedź, której nie da się odczytać — spróbuj ponownie.");
    }
    if (typeof parsed.summary === "string" && parsed.summary.trim()) summaries.push(parsed.summary.trim());
    for (const c of parsed.cuts ?? []) {
      const from = segs.find((s) => s.id === Number(c.from));
      const to = segs.find((s) => s.id === Number(c.to)) ?? from;
      if (!from || !to || to.id < from.id) continue;
      const kind: EduCutKind = c.kind === "retake" || c.kind === "offtopic" ? c.kind : "editor";
      const text = segs.slice(from.id, to.id + 1).map((s) => s.text).join(" ");
      // from just after the previous word to just before the next one (no half words left behind)
      const prevEnd = from.from > 0 ? words[from.from - 1].end : 0;
      const nextStart = to.to + 1 < words.length ? words[to.to + 1].start : to.end + 0.3;
      cuts.push({ id: `cut_${from.id}_${to.id}`, kind, start: Math.max(prevEnd, from.start - 0.15), end: Math.min(nextStart, to.end + 0.15), text: text.slice(0, 600), reason: String(c.reason ?? "").slice(0, 200), enabled: true });
    }
  }
  return { cuts: cuts.sort((a, b) => a.start - b.start), summary: summaries[0] ?? "" };
}

/** Worker "edu-export": the kept ranges in one FFmpeg pass, H.264 + AAC at the chosen size. */
export async function exportEdu(eduId: string) {
  const e = await prisma.eduVideo.findUniqueOrThrow({ where: { id: eduId } });
  const original = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: e.originalAssetId! } });
  const settings = (e.exportSettings ?? {}) as { quality?: EduQuality; resolution?: EduResolution };
  const q = EDU_QUALITY[settings.quality ?? "standard"];
  const keep = keepRanges(e.durationSec ?? 0, (e.cuts as unknown as EduCut[] | null) ?? [], (e.pauses as unknown as Array<{ start: number; end: number }> | null) ?? [], e.pauseMin);
  if (!keep.length) throw new Error("Po cięciach nic nie zostało — wyłącz część cięć.");
  const total = keptDuration(keep);
  const work = await makeTempDir(`edu-export-${eduId}`);
  const src = await toLocalFile(original.storageKey);
  try {
    const graph = path.join(work, "filter.txt");
    await fsp.writeFile(graph, exportFilter(keep, { hasAudio: original.hasAudio, resolution: settings.resolution ?? "source", width: e.width, height: e.height }));
    const out = path.join(work, "out.mp4");
    let last = 0;
    await run(
      env.ffmpeg,
      [
        "-hide_banner", "-y", "-i", src.path, "-filter_complex_script", graph, "-map", "[v]", ...(original.hasAudio ? ["-map", "[a]"] : []),
        "-c:v", "libx264", "-preset", "medium", "-crf", String(q.crf), "-threads", process.env.FFMPEG_THREADS ?? "2",
        ...(original.hasAudio ? ["-c:a", "aac", "-b:a", q.audio, "-ac", "2"] : []), "-movflags", "+faststart", out,
      ],
      {
        onStderr: (line) => {
          const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(line);
          if (!m || !total) return;
          const p = Math.min(0.99, (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / total);
          if (p - last >= 0.02) {
            last = p;
            void prisma.eduVideo.update({ where: { id: eduId }, data: { exportProgress: p } }).catch(() => {});
          }
        },
      },
    );
    const info = await probe(out);
    const key = `edu/${eduId}/export-${Date.now().toString(36)}.mp4`;
    const size = await putFile(key, out, "video/mp4");
    const asset = await prisma.mediaAsset.create({ data: { kind: "RENDER", storageKey: key, mimeType: "video/mp4", sizeBytes: size, durationSec: info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio, hasVideo: true, originalName: `${e.name.replace(/\.[^.]+$/, "")} (EduStudio).mp4` } });
    // the earlier export is replaced
    if (e.exportAssetId) {
      const old = await prisma.mediaAsset.findUnique({ where: { id: e.exportAssetId } });
      if (old) {
        const { deleteAssets } = await import("./assets");
        await deleteAssets([old.id]).catch(() => {});
      }
    }
    await prisma.eduVideo.update({ where: { id: eduId }, data: { exportAssetId: asset.id, exportProgress: 1, status: "DONE", step: "Gotowe do pobrania", error: null } });
    return { assetId: asset.id, size };
  } catch (err) {
    await prisma.eduVideo.update({ where: { id: eduId }, data: { status: "READY", error: `Eksport nie powiódł się: ${(diskFullMessage(err) ?? (err as Error).message).slice(0, 800)}` } });
    throw err;
  } finally {
    await src.cleanup();
    await fsp.rm(work, { recursive: true, force: true });
  }
}
