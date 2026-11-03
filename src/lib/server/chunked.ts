import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { diskUsage, tmpDir } from "./storage";
import { HttpError } from "./errors";

/**
 * Large files arrive in slices (8 MB from the browser, up to 16 MB accepted): each slice is a request
 * of its own (retried by the browser, idempotent), assembled once all are there.
 */
export const MAX_CHUNK = 16 * 1024 * 1024;

export const chunkDir = (scope: string, id: string) => tmpDir(scope, id);
const partPath = (dir: string, i: number) => path.join(dir, `${String(i).padStart(6, "0")}.part`);

export function chunkIndex(index: string): number {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i > 100_000) throw new HttpError(400, "Nieprawidłowy numer części");
  return i;
}

export async function saveChunk(scope: string, id: string, i: number, req: Request) {
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length || buf.length > MAX_CHUNK) throw new HttpError(400, "Nieprawidłowy rozmiar części");
  const dir = chunkDir(scope, id);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(partPath(dir, i), buf);
}

/** Join the slices into one file; each slice is removed right after it is appended (no double disk use). */
export async function assembleChunks(scope: string, id: string, total: number): Promise<{ file: string; dir: string }> {
  const dir = chunkDir(scope, id);
  const file = path.join(dir, "assembled.bin");
  const out = fs.createWriteStream(file);
  try {
    for (let i = 0; i < total; i++) {
      await pipeline(fs.createReadStream(partPath(dir, i)), out, { end: false });
      await fsp.rm(partPath(dir, i), { force: true });
    }
    await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())));
  } catch (e) {
    out.destroy();
    await fsp.rm(file, { force: true });
    throw e;
  }
  return { file, dir };
}

/** MP4 / MOV / WEBM by its first bytes (the browser's MIME type and the file name are not trusted). */
export function sniffVideo(head: Buffer): { ext: string; mime: string } | null {
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) return { ext: "webm", mime: "video/webm" };
  if (head.length >= 8 && head.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = head.subarray(8, 12).toString("latin1");
    return brand === "qt  " ? { ext: "mov", mime: "video/quicktime" } : { ext: "mp4", mime: "video/mp4" };
  }
  return null;
}

export async function readHead(file: string, n = 16): Promise<{ head: Buffer; size: number }> {
  const fd = await fsp.open(file, "r");
  try {
    const head = Buffer.alloc(n);
    await fd.read(head, 0, n, 0);
    return { head, size: (await fd.stat()).size };
  } finally {
    await fd.close();
  }
}

/**
 * Refuse an upload the disk cannot take: the slices, the assembled file and the converted copy need
 * roughly 2.2× the file size while it is processed.
 */
export async function ensureDiskFor(bytes: number) {
  const d = await diskUsage();
  if (d && d.free < bytes * 2.2 + 512 * 1024 * 1024)
    throw new HttpError(507, `Za mało miejsca na dysku serwera: wolne ${(d.free / 1024 ** 3).toFixed(1)} GB, a ten plik potrzebuje ok. ${((bytes * 2.2) / 1024 ** 3).toFixed(1)} GB na czas przetwarzania. Usuń zbędne pliki albo powiększ dysk (Volume) w Railway.`);
}
