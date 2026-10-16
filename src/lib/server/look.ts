import { prisma } from "./db";
import { env } from "./env";
import { run } from "./ffmpeg";
import { toLocalFile } from "./storage";
import type { PictureLook } from "../editor/types";

/**
 * "Magic" picture correction like iMovie's Enhance: the recording is measured once (FFmpeg
 * signalstats on 1 frame/s: mean brightness, 10–90% luminance spread, saturation) and gentle
 * brightness / contrast / saturation factors are derived — dark, flat, grey phone video gets
 * lifted, a good picture is barely touched. Applied at draw time (preview and export), so the
 * original file stays untouched and the correction can be switched off.
 */
export function lookFromStats(s: { yavg: number; ylow: number; yhigh: number; satavg: number }): PictureLook {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const soften = (v: number, k: number) => 1 + (v - 1) * k;
  // auto-levels: stretch the 10–90% luminance spread towards ~160 and centre it around ~115
  const mid = (s.ylow + s.yhigh) / 2;
  const brightness = soften(clamp(115 / Math.max(1, mid), 0.85, 1.35), 0.45);
  const contrast = soften(clamp(160 / Math.max(1, s.yhigh - s.ylow), 0.92, 1.25), 0.5);
  // natural video sits around 15–25 (signalstats chroma); flat, grey footage gets livelier colours
  const saturate = soften(clamp(20 / Math.max(1, s.satavg), 0.9, 1.4), 0.5) * 1.03;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { brightness: r(brightness), contrast: r(contrast), saturate: r(saturate) };
}

export function parseSignalStats(out: string) {
  const sum = { yavg: 0, ylow: 0, yhigh: 0, satavg: 0 };
  let n = 0;
  for (const line of out.split("\n")) {
    const m = /lavfi\.signalstats\.(YAVG|YLOW|YHIGH|SATAVG)=([\d.]+)/.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase() as keyof typeof sum;
    sum[k] += Number(m[2]);
    if (k === "yavg") n++;
  }
  if (!n) return null;
  return { yavg: sum.yavg / n, ylow: sum.ylow / n, yhigh: sum.yhigh / n, satavg: sum.satavg / n };
}

export async function analyzeLook(assetId: string): Promise<PictureLook> {
  const a = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
  const meta = (a.meta ?? {}) as Record<string, unknown>;
  if (meta.look) return meta.look as PictureLook;
  const local = await toLocalFile(a.storageKey);
  try {
    const { stdout } = await run(env.ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", local.path, "-an", "-vf", "fps=1,scale=320:-2,signalstats,metadata=print:file=-", "-f", "null", "-"]);
    const stats = parseSignalStats(stdout.toString());
    const look = stats ? lookFromStats(stats) : { brightness: 1, contrast: 1.03, saturate: 1.06 };
    await prisma.mediaAsset.update({ where: { id: assetId }, data: { meta: { ...meta, look: { ...look } } } });
    return look;
  } finally {
    await local.cleanup();
  }
}
