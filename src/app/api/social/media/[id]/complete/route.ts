import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { diskFullMessage, tmpDir } from "@/lib/server/storage";
import { PermanentError } from "@/lib/server/pipeline";
import { accessVia } from "@/lib/server/social/access";
import { ingestOriginal } from "@/lib/server/social/media";
import { enqueueSocial } from "@/lib/server/social/queue";

export const runtime = "nodejs";
export const maxDuration = 300;

/** assemble the slices, keep the original, queue probing / thumbnail / checks (and the transcript) */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await accessVia("media", id, "content.edit");
  const { totalChunks } = z.object({ totalChunks: z.number().int().min(1).max(100_000) }).parse(await req.json());
  const m = await prisma.socialMedia.findUniqueOrThrow({ where: { id } });
  if (m.status !== "UPLOADING") return json({ ok: true, status: m.status });
  const dir = tmpDir("social-uploads", id);
  const parts = Array.from({ length: totalChunks }, (_, i) => path.join(dir, `${String(i).padStart(6, "0")}.part`));
  const missing: number[] = [];
  for (const [i, p] of parts.entries()) if (!fs.existsSync(p)) missing.push(i);
  if (missing.length) return json({ error: "Brakuje części pliku", missing }, 409);
  const assembled = path.join(dir, "assembled.bin");
  try {
    const out = fs.createWriteStream(assembled);
    for (const part of parts) await pipeline(fs.createReadStream(part), out, { end: false });
    await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())));
    await Promise.all(parts.map((p) => fsp.rm(p, { force: true })));
    await ingestOriginal(id, assembled);
  } catch (e) {
    const full = diskFullMessage(e);
    if (full) return json({ error: full }, 507);
    if (e instanceof PermanentError) return json({ error: e.message }, 415);
    throw e;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
  if (m.transcriptStatus === "Zaplanowana") await enqueueSocial("social-transcribe", { mediaId: id, projectId: a.project.id }, { idempotencyKey: `transcribe:${id}`, maxAttempts: 2 });
  return json({ ok: true, status: "PROCESSING" });
});
