/**
 * Private media storage. Two drivers:
 *  - local: files under STORAGE_LOCAL_DIR, served only through HMAC-signed, expiring URLs
 *  - s3:    S3-compatible bucket (MinIO locally), private, presigned GET URLs
 * Buckets are never public; every URL handed to a browser is signed and expires.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";
import { hmac, safeEqual } from "./crypto";

let s3: S3Client | null = null;
function client(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      region: env.s3.region,
      endpoint: env.s3.endpoint || undefined,
      forcePathStyle: env.s3.forcePathStyle,
      credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
    });
  }
  return s3;
}

function safeKey(key: string): string {
  if (!/^[a-zA-Z0-9/_\-.]+$/.test(key) || key.includes("..") || key.startsWith("/")) throw new Error(`Invalid storage key: ${key}`);
  return key;
}

export function localPathFor(key: string): string {
  return path.join(env.storageDir, "objects", safeKey(key));
}

export function tmpDir(...parts: string[]): string {
  return path.join(env.storageDir, "tmp", ...parts);
}

export async function makeTempDir(prefix: string): Promise<string> {
  const base = tmpDir();
  await fsp.mkdir(base, { recursive: true });
  return fsp.mkdtemp(path.join(base, `${prefix}-`));
}

export async function putFile(key: string, file: string, mime: string): Promise<number> {
  const stat = await fsp.stat(file);
  if (env.storageDriver === "s3") {
    await client().send(new PutObjectCommand({ Bucket: env.s3.bucket, Key: safeKey(key), Body: fs.createReadStream(file), ContentType: mime, ContentLength: stat.size }));
  } else {
    const dest = localPathFor(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    // temp files live on the same volume: a hard link stores the file without a second copy
    // (the work file can still be used and deleted afterwards); copy across filesystems
    await fsp.rm(dest, { force: true });
    try {
      await fsp.link(file, dest);
    } catch {
      await fsp.copyFile(file, dest);
    }
  }
  return stat.size;
}

export async function putBuffer(key: string, buf: Buffer, mime: string): Promise<number> {
  if (env.storageDriver === "s3") {
    await client().send(new PutObjectCommand({ Bucket: env.s3.bucket, Key: safeKey(key), Body: buf, ContentType: mime }));
  } else {
    const dest = localPathFor(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, buf);
  }
  return buf.length;
}

/** Ensure the object is available as a local file (downloads from S3 into a temp file). */
export async function toLocalFile(key: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  if (env.storageDriver === "local") return { path: localPathFor(key), cleanup: async () => {} };
  const dir = await makeTempDir("dl");
  const p = path.join(dir, path.basename(key));
  const res = await client().send(new GetObjectCommand({ Bucket: env.s3.bucket, Key: safeKey(key) }));
  await pipeline(res.Body as Readable, fs.createWriteStream(p));
  return { path: p, cleanup: () => fsp.rm(dir, { recursive: true, force: true }) };
}

export async function deleteObject(key: string): Promise<void> {
  if (env.storageDriver === "s3") await client().send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: safeKey(key) }));
  else await fsp.rm(localPathFor(key), { force: true });
}

export async function readBuffer(key: string): Promise<Buffer> {
  const f = await toLocalFile(key);
  try {
    return await fsp.readFile(f.path);
  } finally {
    await f.cleanup();
  }
}

/** Signed, expiring URL for browser access. */
export async function signedUrl(key: string, opts: { ttlSec?: number; download?: string; mime?: string } = {}): Promise<string> {
  const ttl = opts.ttlSec ?? 6 * 3600;
  if (env.storageDriver === "s3") {
    return getSignedUrl(
      client(),
      new GetObjectCommand({
        Bucket: env.s3.bucket,
        Key: safeKey(key),
        ResponseContentDisposition: opts.download ? `attachment; filename*=UTF-8''${encodeURIComponent(opts.download)}` : undefined,
        ResponseContentType: opts.mime,
      }),
      { expiresIn: ttl },
    );
  }
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const dl = opts.download ?? "";
  const sig = hmac("media", `${key}|${exp}|${dl}`);
  const q = new URLSearchParams({ exp: String(exp), sig });
  if (dl) q.set("dl", dl);
  return `/api/media/${key.split("/").map(encodeURIComponent).join("/")}?${q.toString()}`;
}

export function verifyLocalSignature(key: string, exp: string, sig: string, dl: string): boolean {
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Date.now() / 1000) return false;
  return safeEqual(hmac("media", `${key}|${e}|${dl}`), sig);
}

export function systemTmp(): string {
  return os.tmpdir();
}

/** Free / total bytes of the volume that holds local media and temp files. */
export async function diskUsage(): Promise<{ free: number; total: number; used: number } | null> {
  try {
    await fsp.mkdir(env.storageDir, { recursive: true });
    const s = await fsp.statfs(env.storageDir);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { free, total, used: total - free };
  } catch {
    return null;
  }
}

/**
 * Remove leftovers of interrupted work (a job killed by a deploy or out-of-memory never reaches its
 * cleanup): temp work dirs older than `workHours`, abandoned upload chunks older than `uploadDays`.
 */
export async function cleanupTemp(opts: { workHours?: number; uploadDays?: number } = {}): Promise<{ removed: number; freed: number }> {
  const base = tmpDir();
  const now = Date.now();
  let removed = 0;
  let freed = 0;
  const sizeOf = async (p: string): Promise<number> => {
    const st = await fsp.lstat(p).catch(() => null);
    if (!st) return 0;
    if (!st.isDirectory()) return st.size;
    let n = 0;
    for (const e of await fsp.readdir(p).catch(() => [] as string[])) n += await sizeOf(path.join(p, e));
    return n;
  };
  const newest = async (p: string): Promise<number> => {
    const st = await fsp.lstat(p).catch(() => null);
    if (!st) return 0;
    let t = st.mtimeMs;
    if (st.isDirectory()) for (const e of await fsp.readdir(p).catch(() => [] as string[])) t = Math.max(t, await newest(path.join(p, e)));
    return t;
  };
  const sweep = async (dir: string, maxAgeMs: number) => {
    for (const name of await fsp.readdir(dir).catch(() => [] as string[])) {
      if (dir === base && name === "uploads") continue;
      const p = path.join(dir, name);
      if (now - (await newest(p)) < maxAgeMs) continue;
      freed += await sizeOf(p);
      await fsp.rm(p, { recursive: true, force: true }).catch(() => {});
      removed++;
    }
  };
  await sweep(base, (opts.workHours ?? 6) * 3600_000);
  await sweep(path.join(base, "uploads"), (opts.uploadDays ?? 3) * 86400_000);
  return { removed, freed };
}

/** Human message for a full disk (shown on the take instead of a raw ENOSPC). */
export function diskFullMessage(e: unknown): string | null {
  const err = e as NodeJS.ErrnoException;
  if (err?.code !== "ENOSPC" && !/ENOSPC|no space left/i.test(err?.message ?? "")) return null;
  return "Brak miejsca na dysku serwera (wolumen z nagraniami jest pełny). Zwiększ wolumen w Railway albo podłącz magazyn S3/R2, a potem kliknij „Ponów przetwarzanie”.";
}
