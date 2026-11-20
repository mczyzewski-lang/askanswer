import fs from "node:fs";
import { Zip, ZipPassThrough } from "fflate";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { toLocalFile } from "@/lib/server/storage";

export const maxDuration = 300;

/**
 * Several finished renders as one ZIP (?ids=a,b,c): the hook versions of a reel in one download
 * instead of a link per file. Streamed and stored without compression (MP4 does not compress).
 */
export const GET = route(async (req: Request) => {
  await requireAdmin();
  const ids = [...new Set((new URL(req.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 200);
  if (!ids.length) return json({ error: "Brak renderów do spakowania." }, 400);
  const jobs = await prisma.renderJob.findMany({ where: { id: { in: ids }, status: "SUCCEEDED", outputAssetId: { not: null } } });
  const assets = await prisma.mediaAsset.findMany({ where: { id: { in: jobs.map((j) => j.outputAssetId!) } } });
  // in the order asked for
  const files = ids.flatMap((id) => {
    const a = assets.find((x) => x.id === jobs.find((j) => j.id === id)?.outputAssetId);
    return a ? [a] : [];
  });
  if (!files.length) return json({ error: "Żaden z tych renderów nie jest jeszcze gotowy." }, 409);
  const used = new Set<string>();
  const nameOf = (raw: string) => {
    const clean = raw.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-");
    const dot = clean.lastIndexOf(".");
    const [base, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ""];
    let name = clean;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}-${n}${ext}`;
    used.add(name.toLowerCase());
    return name;
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const zip = new Zip((err, chunk, final) => {
        if (err) return controller.error(err);
        controller.enqueue(chunk);
        if (final) controller.close();
      });
      try {
        for (const a of files) {
          const local = await toLocalFile(a.storageKey);
          try {
            const entry = new ZipPassThrough(nameOf(a.originalName ?? `${a.id}.mp4`));
            zip.add(entry);
            for await (const chunk of fs.createReadStream(local.path, { highWaterMark: 1 << 20 })) entry.push(chunk as Uint8Array);
            entry.push(new Uint8Array(0), true);
          } finally {
            await local.cleanup();
          }
        }
        zip.end();
      } catch (e) {
        controller.error(e);
      }
    },
  });
  const comp = jobs[0]?.compositionId ? await prisma.videoComposition.findUnique({ where: { id: jobs[0].compositionId }, select: { name: true } }) : null;
  const zipName = `${(comp?.name ?? "reelsy").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "reelsy"}_${files.length}-mp4.zip`;
  return new Response(stream, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`, "cache-control": "no-store" } });
});
