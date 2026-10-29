/**
 * Media library of Social Media Studio: films uploaded in chunks (or imported from a URL / an
 * AskBy Studio render), probed with FFprobe, a thumbnail, a compliance check for every platform, an
 * optional vertical 1080×1920 H.264 version (derived — the original is never modified) and an
 * optional transcript (ElevenLabs).
 */
import dns from "node:dns/promises";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { env, elevenLabsConfigured } from "../env";
import { run, probe } from "../ffmpeg";
import { deleteObject, makeTempDir, putFile, toLocalFile } from "../storage";
import { PLATFORMS } from "@/lib/social/platforms";
import { checkVideo, RULES_VERSION, type VideoCheck } from "@/lib/social/rules";
import { PermanentError } from "../pipeline";

export const MAX_MEDIA_BYTES = () => Number(process.env.SOCIAL_MAX_UPLOAD_MB ?? 4096) * 1024 * 1024;

export const mediaKey = (projectId: string, mediaId: string, file: string) => `social/${projectId}/media/${mediaId}/${file}`;

export function sniffVideo(head: Buffer): { ext: string; mime: string } | null {
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) return { ext: "webm", mime: "video/webm" };
  if (head.length >= 8 && head.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = head.subarray(8, 12).toString("latin1");
    return brand === "qt  " ? { ext: "mov", mime: "video/quicktime" } : { ext: "mp4", mime: "video/mp4" };
  }
  return null;
}

/** store an assembled / downloaded file as the original and queue processing */
export async function ingestOriginal(mediaId: string, file: string) {
  const m = await prisma.socialMedia.findUniqueOrThrow({ where: { id: mediaId } });
  const fd = await fsp.open(file, "r");
  const head = Buffer.alloc(16);
  await fd.read(head, 0, 16, 0);
  const size = (await fd.stat()).size;
  await fd.close();
  const kind = sniffVideo(head);
  if (!kind) {
    await prisma.socialMedia.update({ where: { id: mediaId }, data: { status: "FAILED", error: "To nie jest plik wideo (MP4 / MOV / WEBM)." } });
    throw new PermanentError("To nie jest plik wideo (MP4 / MOV / WEBM).");
  }
  if (size > MAX_MEDIA_BYTES()) {
    await prisma.socialMedia.update({ where: { id: mediaId }, data: { status: "FAILED", error: "Plik jest za duży." } });
    throw new PermanentError("Plik jest za duży.");
  }
  const key = mediaKey(m.projectId, m.id, `original.${kind.ext}`);
  await putFile(key, file, kind.mime);
  await prisma.socialMedia.update({ where: { id: mediaId }, data: { storageKey: key, mimeType: kind.mime, sizeBytes: BigInt(size), status: "PROCESSING" } });
  const { enqueueSocial } = await import("./queue");
  await enqueueSocial("social-media", { mediaId }, { idempotencyKey: `social-media:${mediaId}:${key}`, maxAttempts: 2 });
}

/** job "social-media": metadata, thumbnail, platform checks */
export async function processMedia(mediaId: string) {
  const m = await prisma.socialMedia.findUniqueOrThrow({ where: { id: mediaId } });
  const local = await toLocalFile(m.storageKey);
  const dir = await makeTempDir("smthumb");
  try {
    const p = await probe(local.path);
    if (!p.hasVideo) {
      await prisma.socialMedia.update({ where: { id: mediaId }, data: { status: "FAILED", error: "Plik nie zawiera obrazu wideo." } });
      return { ok: false };
    }
    const thumb = path.join(dir, "thumb.jpg");
    const at = Math.min(1, Math.max(0, p.duration / 3));
    await run(env.ffmpeg, ["-hide_banner", "-y", "-ss", at.toFixed(2), "-i", local.path, "-frames:v", "1", "-vf", "scale='if(gt(iw,ih),640,-2)':'if(gt(iw,ih),-2,640)'", "-q:v", "4", thumb]);
    const thumbKey = mediaKey(m.projectId, m.id, "thumb.jpg");
    await putFile(thumbKey, thumb, "image/jpeg");
    const bitrate = p.duration > 0 ? Math.round((Number(m.sizeBytes) * 8) / p.duration) : null;
    const meta = { durationSec: p.duration || null, width: p.width, height: p.height, videoCodec: p.videoCodec, audioCodec: p.audioCodec, sizeBytes: Number(m.sizeBytes), container: p.formatName };
    const checks: Record<string, VideoCheck & { rulesVersion: string }> = {};
    for (const pl of PLATFORMS) checks[pl] = { ...checkVideo(pl, meta), rulesVersion: RULES_VERSION };
    await prisma.socialMedia.update({
      where: { id: mediaId },
      data: { status: "READY", error: null, durationSec: p.duration || null, width: p.width, height: p.height, fps: p.fps, videoCodec: p.videoCodec, audioCodec: p.audioCodec, bitrate, thumbnailKey: thumbKey, checks: checks as unknown as Prisma.InputJsonValue },
    });
    return { ok: true };
  } finally {
    await local.cleanup();
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/** job "social-convert": vertical 1080×1920 H.264 / AAC, the film fitted over a blurred copy of itself */
export async function convertMedia(variantId: string) {
  const v = await prisma.socialMediaVariant.findUniqueOrThrow({ where: { id: variantId }, include: { media: true } });
  const local = await toLocalFile(v.media.storageKey);
  const dir = await makeTempDir("smconv");
  try {
    const out = path.join(dir, "vertical.mp4");
    const filter = "[0:v]split=2[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:2[bg];[b]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p,fps=30[v]";
    const args = ["-hide_banner", "-y", "-i", local.path, "-filter_complex", filter, "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-profile:v", "high", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", out];
    await run(env.ffmpeg, args);
    const p = await probe(out);
    const key = mediaKey(v.media.projectId, v.mediaId, `${v.kind}.mp4`);
    const size = await putFile(key, out, "video/mp4");
    await prisma.socialMediaVariant.update({ where: { id: variantId }, data: { status: "READY", storageKey: key, width: p.width, height: p.height, durationSec: p.duration, sizeBytes: BigInt(size), error: null } });
    return { ok: true };
  } catch (e) {
    await prisma.socialMediaVariant.update({ where: { id: variantId }, data: { status: "FAILED", error: (e as Error).message.slice(0, 1000) } });
    throw e;
  } finally {
    await local.cleanup();
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/** job "social-transcribe": the speech as text (context for the AI) */
export async function transcribeMedia(mediaId: string) {
  if (!elevenLabsConfigured()) {
    await prisma.socialMedia.update({ where: { id: mediaId }, data: { transcriptStatus: "Transkrypcja wymaga klucza ElevenLabs." } });
    return { ok: false };
  }
  const m = await prisma.socialMedia.findUniqueOrThrow({ where: { id: mediaId } });
  await prisma.socialMedia.update({ where: { id: mediaId }, data: { transcriptStatus: "W trakcie…" } });
  const local = await toLocalFile(m.storageKey);
  const dir = await makeTempDir("smstt");
  try {
    const audio = path.join(dir, "speech.mp3");
    await run(env.ffmpeg, ["-hide_banner", "-y", "-i", local.path, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", audio]);
    const { transcribe } = await import("../elevenlabs");
    const project = await prisma.socialProject.findUnique({ where: { id: m.projectId }, select: { language: true } });
    const r = await transcribe(audio, { language: project?.language === "en" ? "eng" : "pol" });
    await prisma.socialMedia.update({ where: { id: mediaId }, data: { transcript: r.text.slice(0, 60_000), transcriptStatus: "Gotowa" } });
    return { ok: true };
  } catch (e) {
    await prisma.socialMedia.update({ where: { id: mediaId }, data: { transcriptStatus: `Błąd: ${(e as Error).message.slice(0, 300)}` } });
    throw e;
  } finally {
    await local.cleanup();
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/** a URL may only point to the public internet (no localhost / private networks / metadata service) */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new PermanentError("Nieprawidłowy adres URL.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new PermanentError("Dozwolone są tylko adresy http(s).");
  if (u.username || u.password) throw new PermanentError("Adres nie może zawierać loginu i hasła.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length || addrs.some(isPrivateAddress)) throw new PermanentError("Ten adres wskazuje na sieć wewnętrzną — niedozwolony.");
  return u;
}

/** job "social-import-url": download a film (redirects re-checked, size capped) */
export async function importFromUrl(mediaId: string) {
  const m = await prisma.socialMedia.findUniqueOrThrow({ where: { id: mediaId } });
  const dir = await makeTempDir("smurl");
  try {
    let url = await assertPublicUrl(m.sourceUrl ?? "");
    let res: Response | null = null;
    for (let hop = 0; hop < 5; hop++) {
      res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10 * 60_000) });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        url = await assertPublicUrl(new URL(res.headers.get("location")!, url).toString());
        continue;
      }
      break;
    }
    if (!res || !res.ok || !res.body) throw new PermanentError(`Nie udało się pobrać filmu (HTTP ${res?.status ?? "?"}).`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_MEDIA_BYTES()) throw new PermanentError("Plik pod adresem jest za duży.");
    const file = path.join(dir, "download.bin");
    let seen = 0;
    const limit = MAX_MEDIA_BYTES();
    const body = Readable.fromWeb(res.body as never);
    body.on("data", (c: Buffer) => {
      seen += c.length;
      if (seen > limit) body.destroy(new PermanentError("Plik pod adresem jest za duży."));
    });
    await pipeline(body, fs.createWriteStream(file));
    await ingestOriginal(mediaId, file);
    return { ok: true, bytes: seen };
  } catch (e) {
    await prisma.socialMedia.update({ where: { id: mediaId }, data: { status: "FAILED", error: (e as Error).message.slice(0, 500) } });
    if (e instanceof PermanentError) return { ok: false, error: e.message };
    throw e;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

export async function deleteMedia(mediaId: string) {
  const m = await prisma.socialMedia.findUniqueOrThrow({ where: { id: mediaId }, include: { variants: true, contentItems: { include: { posts: { select: { status: true } } } } } });
  const live = m.contentItems.some((c) => c.posts.some((p) => ["SCHEDULING", "SCHEDULED", "PUBLISHING"].includes(p.status)));
  if (live) throw new PermanentError("Ten film ma zaplanowane publikacje — najpierw je anuluj.");
  const keys = [m.storageKey, m.thumbnailKey, ...m.variants.map((v) => v.storageKey)].filter((k): k is string => !!k && !k.startsWith("pending/"));
  await prisma.socialMedia.delete({ where: { id: mediaId } });
  for (const k of keys) await deleteObject(k).catch(() => {});
}
