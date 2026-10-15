import fs from "node:fs";
import { Readable } from "node:stream";
import { prisma } from "@/lib/server/db";
import { localPathFor, verifyLocalSignature } from "@/lib/server/storage";

export const runtime = "nodejs";

/** Serves private media from the local driver. Requires a valid, unexpired HMAC signature. Supports Range. */
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await ctx.params;
  const key = parts.map(decodeURIComponent).join("/");
  const url = new URL(req.url);
  const dl = url.searchParams.get("dl") ?? "";
  if (!verifyLocalSignature(key, url.searchParams.get("exp") ?? "", url.searchParams.get("sig") ?? "", dl)) {
    return new Response("Link wygasł lub jest nieprawidłowy", { status: 403 });
  }
  let file: string;
  try {
    file = localPathFor(key);
  } catch {
    return new Response("Bad key", { status: 400 });
  }
  if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });
  const asset = await prisma.mediaAsset.findUnique({ where: { storageKey: key }, select: { mimeType: true } });
  const mime = asset?.mimeType ?? "application/octet-stream";
  const size = fs.statSync(file).size;
  const headers: Record<string, string> = {
    "content-type": mime,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
  };
  if (dl) headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(dl)}`;
  const range = req.headers.get("range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? Number(m[1]) : 0;
    let end = m && m[2] ? Number(m[2]) : size - 1;
    if (m && !m[1] && m[2]) {
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    }
    if (start >= size || end >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const stream = fs.createReadStream(file, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { headers: { ...headers, "content-length": String(size) } });
}
