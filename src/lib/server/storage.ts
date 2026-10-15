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
    await fsp.copyFile(file, dest);
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
