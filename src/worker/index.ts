/**
 * Background worker: processes uploads, transcriptions and renders.
 * Run with `npm run worker` (started automatically by `npm run dev`).
 */
import os from "node:os";
import { prisma } from "../lib/server/db";
import { claimJob, completeJob, failJob, startHeartbeat } from "../lib/server/jobs";
import { processTake, transcribeTake, PermanentError } from "../lib/server/pipeline";
import { runRender } from "../lib/server/render-job";
import { enhanceComposition } from "../lib/server/enhance";
import { ElevenLabsError } from "../lib/server/elevenlabs";
import { generateBroll, generateInfographic } from "../lib/server/broll";
import { HiggsfieldError } from "../lib/server/higgsfield";
import { OpenAIImageError } from "../lib/server/openai-images";
import { cleanupTemp } from "../lib/server/storage";

const workerId = `${os.hostname()}-${process.pid}`;
let stopping = false;

async function handle(job: { id: string; type: string; payload: unknown }) {
  const p = job.payload as Record<string, string>;
  switch (job.type) {
    case "process-take":
      return processTake(p.takeId);
    case "transcribe-take":
      return transcribeTake(p.takeId, Boolean(p.force));
    case "render":
      return runRender(p.renderJobId);
    case "enhance-audio":
      return { map: await enhanceComposition(p.compositionId, p.mode as "podcast" | "isolator", (p.strength as "natural" | "podcast" | "radio") ?? "podcast") };
    case "generate-broll":
      return generateBroll(job.id, job.payload as Parameters<typeof generateBroll>[1]);
    case "auto-visuals": {
      const { autoVisuals } = await import("../lib/server/auto-visuals");
      return autoVisuals(job.id, p.compositionId, Boolean((job.payload as { force?: boolean }).force));
    }
    case "auto-polish": {
      const { autoPolish } = await import("../lib/server/auto-polish");
      return autoPolish(p.compositionId);
    }
    case "segment-asset": {
      const { segmentAsset } = await import("../lib/server/segment");
      return segmentAsset(p.assetId);
    }
    case "generate-infographic":
      return generateInfographic(job.id, job.payload as Parameters<typeof generateInfographic>[1]);
    default:
      throw new PermanentError(`Unknown job type ${job.type}`);
  }
}

/** Leftovers of interrupted jobs/uploads would otherwise slowly fill the volume. */
async function sweepTemp() {
  try {
    const r = await cleanupTemp();
    if (r.removed) console.log(`[worker] cleaned ${r.removed} stale temp entries (${(r.freed / 1e6).toFixed(1)} MB)`);
  } catch (e) {
    console.error("[worker] temp cleanup failed", (e as Error).message);
  }
}

/** Two lanes in one process: FFmpeg/transcription work, and AI jobs that mostly wait on APIs. */
async function loop(lane: "media" | "ai") {
  console.log(`[worker] ${workerId} ${lane} lane started`);
  while (!stopping) {
    let job;
    try {
      job = await claimJob(workerId, lane);
    } catch (e) {
      console.error("[worker] claim failed", (e as Error).message);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    if (!job) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    const t0 = Date.now();
    console.log(`[worker] ${job.type} ${job.id} (attempt ${job.attempts})`);
    const stopBeat = startHeartbeat(job.id);
    try {
      const result = await handle(job);
      stopBeat();
      await completeJob(job.id, result ?? undefined);
      console.log(`[worker] ✓ ${job.type} ${job.id} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      stopBeat();
      const err = e as Error;
      const retryable = !(err instanceof PermanentError) && !(err instanceof ElevenLabsError && !err.retryable) && !(err instanceof HiggsfieldError && !err.retryable) && !(err instanceof OpenAIImageError && !err.retryable);
      const gaveUp = await failJob(job.id, err.message, retryable);
      console.error(`[worker] ✗ ${job.type} ${job.id}: ${err.message}${gaveUp ? " (giving up)" : " (will retry)"}`);
      if (gaveUp && job.type === "render") {
        const rid = (job.payload as Record<string, string>).renderJobId;
        await prisma.renderJob.update({ where: { id: rid }, data: { status: "FAILED", error: err.message.slice(0, 2000) } }).catch(() => {});
      }
    }
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
    setTimeout(() => process.exit(0), 500);
  });
}

void sweepTemp();
setInterval(() => void sweepTemp(), 3600_000).unref();
for (const lane of ["media", "ai"] as const)
  loop(lane).catch((e) => {
    console.error(e);
    process.exit(1);
  });
