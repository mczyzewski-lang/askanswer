/**
 * Automation pipeline for an uploaded take. Every step is idempotent: re-running the
 * job skips steps whose results already exist, and the source upload is never modified.
 *
 *  1 validate · 2 original saved (upload) · 3 normalize · 4 waveform · 5–6 transcribe (separate,
 *  retryable job) · 7 subtitles · 8 silences · 9–15 composition "Gotowe do edycji"
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { decodeDuration, decodePcm, extractSpeechAudio, normalizeRecording, probe } from "./ffmpeg";
import { makeTempDir, putFile, toLocalFile } from "./storage";
import { computeWaveform, detectPauses } from "../editor/silence";
import { buildSegments } from "../editor/subtitles";
import { buildInitialDocument } from "../editor/factory";
import { themeFromRow, DEFAULT_THEME } from "../themes";
import type { EditorDocument, Waveform } from "../editor/types";
import { ElevenLabsError, transcribe } from "./elevenlabs";
import { elevenLabsConfigured } from "./env";
import { enqueue } from "./jobs";
import { uid } from "../editor/id";

async function step(takeId: string, name: string) {
  await prisma.recordingTake.update({ where: { id: takeId }, data: { processingStep: name } });
}

interface Markers {
  narrationStart?: number | null;
  narrationEnd?: number | null;
}

export async function processTake(takeId: string): Promise<void> {
  const take = await prisma.recordingTake.findUniqueOrThrow({ where: { id: takeId }, include: { recording: true } });
  if (!take.originalAssetId) throw new Error("Take has no uploaded media");
  const original = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: take.originalAssetId } });
  await prisma.recordingTake.update({ where: { id: takeId }, data: { status: "PROCESSING", processingError: null } });
  const work = await makeTempDir(`take-${takeId}`);
  const src = await toLocalFile(original.storageKey);
  try {
    // 1. validate
    await step(takeId, "Weryfikacja nagrania");
    const info = await probe(src.path);
    if (!info.hasVideo) throw new PermanentError("Plik nie zawiera ścieżki wideo");
    let duration = info.duration;
    if (!duration || duration < 0.3 || info.formatName.includes("webm")) duration = await decodeDuration(src.path);
    if (duration < 0.3) throw new PermanentError("Nagranie jest puste lub uszkodzone");
    await prisma.mediaAsset.update({
      where: { id: original.id },
      data: { durationSec: duration, width: info.width, height: info.height, fps: info.fps, hasAudio: info.hasAudio, hasVideo: true, meta: { probe: info } as unknown as Prisma.InputJsonValue },
    });

    // 3. normalize (orientation, CFR, H.264/AAC) — new asset, original untouched
    let normalizedId = take.normalizedAssetId;
    if (!normalizedId) {
      await step(takeId, "Normalizacja wideo");
      const out = path.join(work, "normalized.mp4");
      await normalizeRecording(src.path, out, undefined, duration);
      const n = await probe(out);
      const key = `projects/${take.recording.projectId}/takes/${takeId}/normalized.mp4`;
      const size = await putFile(key, out, "video/mp4");
      const asset = await prisma.mediaAsset.upsert({
        where: { storageKey: key },
        create: {
          kind: "RECORDING_NORMALIZED",
          projectId: take.recording.projectId,
          storageKey: key,
          mimeType: "video/mp4",
          sizeBytes: size,
          durationSec: n.duration,
          width: n.width,
          height: n.height,
          fps: n.fps,
          hasAudio: n.hasAudio,
          hasVideo: n.hasVideo,
        },
        update: { sizeBytes: size, durationSec: n.duration, width: n.width, height: n.height },
      });
      normalizedId = asset.id;
      await prisma.recordingTake.update({ where: { id: takeId }, data: { normalizedAssetId: asset.id, durationSec: n.duration } });
    }
    const normalized = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: normalizedId } });
    const nLocal = await toLocalFile(normalized.storageKey);

    try {
      // 4. waveform / energy envelope from the real audio
      if (!normalized.waveform) {
        await step(takeId, "Analiza dźwięku");
        const pcm = normalized.hasAudio ? await decodePcm(nLocal.path, 16000) : new Float32Array(0);
        const wf = computeWaveform(pcm, 16000, 100);
        await prisma.mediaAsset.update({ where: { id: normalized.id }, data: { waveform: wf as unknown as Prisma.InputJsonValue } });
      }

      // speech audio for transcription (small mp3)
      if (!take.analysisAssetId && normalized.hasAudio) {
        const mp3 = path.join(work, "speech.mp3");
        await extractSpeechAudio(nLocal.path, mp3);
        const key = `projects/${take.recording.projectId}/takes/${takeId}/speech.mp3`;
        const size = await putFile(key, mp3, "audio/mpeg");
        const a = await prisma.mediaAsset.upsert({
          where: { storageKey: key },
          create: { kind: "AUDIO_ANALYSIS", projectId: take.recording.projectId, storageKey: key, mimeType: "audio/mpeg", sizeBytes: size, durationSec: normalized.durationSec, hasAudio: true },
          update: {},
        });
        await prisma.recordingTake.update({ where: { id: takeId }, data: { analysisAssetId: a.id } });
      }
    } finally {
      await nLocal.cleanup();
    }

    // 5–6 transcription in-line when possible (it is also retryable as its own job)
    let transcribed = !!(await prisma.transcript.findUnique({ where: { takeId } }));
    if (!transcribed && elevenLabsConfigured() && normalized.hasAudio) {
      await step(takeId, "Transkrypcja ElevenLabs");
      try {
        await transcribeTake(takeId);
        transcribed = true;
      } catch (e) {
        const msg = (e as Error).message;
        await prisma.recordingTake.update({ where: { id: takeId }, data: { transcriptionError: msg } });
        if (e instanceof ElevenLabsError && e.retryable) await enqueue("transcribe-take", { takeId }, { idempotencyKey: `transcribe:${takeId}`, maxAttempts: 5, runAt: new Date(Date.now() + 30_000) });
      }
    } else if (!elevenLabsConfigured()) {
      await prisma.recordingTake.update({ where: { id: takeId }, data: { transcriptionError: "Transkrypcja wymaga konfiguracji ElevenLabs (ELEVENLABS_API_KEY)." } });
    }

    // 8. silence suggestions
    await step(takeId, "Wykrywanie pauz");
    await refreshSilences(takeId);

    // 9–15. composition
    await step(takeId, "Tworzenie kompozycji");
    await ensureComposition(takeId);

    await prisma.recordingTake.update({ where: { id: takeId }, data: { status: "READY", processingStep: "Gotowe do edycji" } });
    const q = await prisma.question.findUnique({ where: { id: take.recording.questionId } });
    if (q && (q.status === "TO_RECORD" || q.status === "IN_PROGRESS")) await prisma.question.update({ where: { id: q.id }, data: { status: "RECORDED" } });
  } catch (e) {
    await prisma.recordingTake.update({ where: { id: takeId }, data: { status: "FAILED", processingError: (e as Error).message.slice(0, 2000) } });
    throw e;
  } finally {
    await src.cleanup();
    await fsp.rm(work, { recursive: true, force: true });
  }
}

export class PermanentError extends Error {}

/** Transcribe with ElevenLabs Scribe; skip if the transcript already exists (idempotent). */
export async function transcribeTake(takeId: string, force = false): Promise<void> {
  const take = await prisma.recordingTake.findUniqueOrThrow({ where: { id: takeId }, include: { transcript: true } });
  if (take.transcript && !force) return;
  const assetId = take.analysisAssetId ?? take.normalizedAssetId;
  if (!assetId) throw new Error("Nagranie nie zostało jeszcze przetworzone");
  const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
  const f = await toLocalFile(asset.storageKey);
  let result;
  try {
    result = await transcribe(f.path, { language: "pol" });
  } finally {
    await f.cleanup();
  }
  const words = result.words.filter((w) => w.type === "word" || w.type === undefined);
  await prisma.$transaction(async (tx) => {
    if (take.transcript) await tx.transcript.delete({ where: { id: take.transcript.id } });
    const tr = await tx.transcript.create({
      data: {
        takeId,
        mediaAssetId: take.normalizedAssetId ?? assetId,
        provider: "elevenlabs",
        model: result.model,
        languageCode: result.language_code ?? "pol",
        text: result.text ?? "",
        raw: result as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.transcriptWord.createMany({
      data: result.words.map((w, i) => ({ transcriptId: tr.id, index: i, text: w.text, start: w.start, end: w.end, type: w.type ?? "word", logprob: w.logprob ?? null })),
    });
    const groups = buildSegments("x", words);
    let wi = 0;
    await tx.subtitleSegment.createMany({
      data: groups.map((g, i) => {
        const idx = g.words.map(() => wi++);
        return { transcriptId: tr.id, index: i, text: g.words.map((w) => w.text).join(" "), start: g.words[0].start, end: g.words[g.words.length - 1].end, wordIndexes: idx };
      }),
    });
  });
  await prisma.recordingTake.update({ where: { id: takeId }, data: { transcriptionError: null } });
  // refine silences with word timings and fill subtitles in compositions that have none yet
  await refreshSilences(takeId);
  const comps = await prisma.videoComposition.findMany({ where: { takeId } });
  for (const c of comps) {
    const doc = c.document as unknown as EditorDocument;
    if (doc.subtitles.source !== "none" && !force) continue;
    if (doc.subtitles.source === "edited") continue;
    const assetIdForSubs = doc.clips[0]?.assetId ?? take.normalizedAssetId!;
    const next: EditorDocument = { ...doc, subtitles: { ...doc.subtitles, segments: buildSegments(assetIdForSubs, words), source: "transcript" } };
    await prisma.videoComposition.update({ where: { id: c.id }, data: { document: next as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
  }
}

export async function refreshSilences(takeId: string) {
  const take = await prisma.recordingTake.findUniqueOrThrow({ where: { id: takeId }, include: { transcript: { include: { words: true } } } });
  if (!take.normalizedAssetId) return [];
  const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: take.normalizedAssetId } });
  const wf = asset.waveform as unknown as Waveform | null;
  if (!wf) return [];
  const markers = (take.markers ?? {}) as Markers;
  const exclude: Array<[number, number]> = [];
  if (take.mode === "CONTINUOUS" && markers.narrationEnd) exclude.push([0, markers.narrationEnd]);
  const words = (take.transcript?.words ?? []).filter((w) => w.type === "word");
  const pauses = detectPauses({ waveform: wf, words, sensitivity: "standard", padding: 0.2, exclude });
  await prisma.$transaction([
    prisma.silenceSuggestion.deleteMany({ where: { takeId, status: "PENDING" } }),
    prisma.silenceSuggestion.createMany({ data: pauses.map((p) => ({ takeId, start: p.start, end: p.end, confidence: p.confidence, sensitivity: "standard" })) }),
  ]);
  return pauses;
}

/** Create the editable composition for a take if it does not exist yet. */
export async function ensureComposition(takeId: string) {
  const existing = await prisma.videoComposition.findFirst({ where: { takeId } });
  if (existing) return existing;
  const take = await prisma.recordingTake.findUniqueOrThrow({
    where: { id: takeId },
    include: {
      recording: { include: { question: true, project: { include: { theme: true } } } },
      transcript: { include: { words: { orderBy: { index: "asc" } } } },
      silences: true,
    },
  });
  const normalized = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: take.normalizedAssetId! } });
  const narration = take.narrationAssetId ? await prisma.mediaAsset.findUnique({ where: { id: take.narrationAssetId } }) : null;
  const project = take.recording.project;
  const theme = project.theme ? themeFromRow(project.theme) : DEFAULT_THEME;
  const markers = (take.markers ?? {}) as Markers;
  const words = (take.transcript?.words ?? []).filter((w) => w.type === "word");
  const doc = buildInitialDocument({
    questionText: take.recording.question.text,
    theme,
    mode: take.mode,
    recording: { assetId: normalized.id, duration: normalized.durationSec ?? take.durationSec ?? 0 },
    narration: narration ? { assetId: narration.id, duration: narration.durationSec ?? 0 } : null,
    narrationWindow: take.mode === "CONTINUOUS" && markers.narrationEnd != null ? { start: markers.narrationStart ?? 0, end: markers.narrationEnd } : null,
    segments: buildSegments(normalized.id, words),
    pauses: take.silences.filter((s) => s.status === "PENDING").map((s) => ({ start: s.start, end: s.end, confidence: s.confidence })),
    visibility: project.questionVisibility,
    questionSeconds: project.questionSeconds,
    logo: !!project.theme?.logoAssetId,
  });
  return prisma.videoComposition.create({
    data: {
      projectId: project.id,
      questionId: take.recording.questionId,
      takeId,
      name: `${take.recording.question.text.slice(0, 80)} — ujęcie ${take.takeNumber}`,
      status: "READY_TO_EDIT",
      document: doc as unknown as Prisma.InputJsonValue,
    },
  });
}

export { uid };
