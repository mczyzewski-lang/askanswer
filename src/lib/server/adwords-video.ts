/**
 * Google Adwords — the storyboard video (animatic) of a video concept, in 16:9, 1:1 and 9:16: one frame
 * per scene (the same canvas drawing and theme fonts as the images), the expert's lines voiced by the
 * project's narrator (ElevenLabs, when configured — silence otherwise), the subtitles (.srt from the
 * scenes) embedded as a subtitle track, H.264 + AAC. It shows the script in time; it is not the filmed ad.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { createCanvas, loadImage, type Image } from "@napi-rs/canvas";
import { prisma } from "./db";
import { env, elevenLabsConfigured } from "./env";
import { makeTempDir, putFile, toLocalFile, signedUrl } from "./storage";
import { probe, run } from "./ffmpeg";
import { ensureNarration } from "./narration";
import { registerFonts } from "../render/server-render";
import { themeFromRow, DEFAULT_THEME } from "../themes";
import { drawSceneFrame } from "../adwords/draw";
import { PMAX_SPEC, formatKeyOf } from "../adwords/spec";
import { scenesToSrt, videoDuration } from "../adwords/video";
import { slugify } from "../adwords/csv";
import { toAdAsset } from "./adwords";
import type { AssetEdit } from "./adwords";

async function imageOf(assetId: string | null | undefined): Promise<Image | null> {
  if (!assetId) return null;
  const a = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!a) return null;
  const f = await toLocalFile(a.storageKey);
  try {
    return await loadImage(await fsp.readFile(f.path));
  } finally {
    await f.cleanup();
  }
}

/** Worker "adwords-video": render the concept's animatic in every orientation of its variants. */
export async function renderAdwordsVideo(projectId: string, conceptId: string, voice = true) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { theme: { include: { expertPhotos: true } } } });
  const rows = await prisma.adwordsAsset.findMany({ where: { projectId, conceptId, rowType: { in: ["video", "video_scene"] } } });
  const variants = rows.filter((r) => r.rowType === "video");
  const scenes = rows.filter((r) => r.rowType === "video_scene").sort((a, b) => (a.sceneIndex ?? 0) - (b.sceneIndex ?? 0));
  if (!scenes.length) throw new Error("Koncept nie ma scen — dodaj scenariusz (video_scene).");
  const total = Math.max(PMAX_SPEC.videos.minSeconds, videoDuration({ conceptId, variants: variants.map(toAdAsset), scenes: scenes.map(toAdAsset) }));
  // scene spans without gaps: a gap belongs to the scene before it
  const spans = scenes.map((s, i) => {
    const a = i === 0 ? 0 : (scenes[i - 1].endS ?? s.startS ?? 0);
    const b = i === scenes.length - 1 ? total : Math.max(a + 0.5, scenes[i + 1].startS ?? s.endS ?? a + 3);
    return { s, a, b };
  });
  registerFonts();
  const theme = project.theme ? themeFromRow(project.theme) : DEFAULT_THEME;
  // the storyboard frames are dark: the dark-background logo when the theme has one
  const logo = (await imageOf(project.theme?.logoDarkAssetId)) ?? (await imageOf(project.theme?.logoAssetId));
  const photos = new Map<string, Image | null>();
  const photoFor = async (key: string | null, id: string | null) => {
    const p = id ? project.theme?.expertPhotos.find((x) => x.id === id) : key ? project.theme?.expertPhotos.find((x) => x.key === key) : null;
    if (!p || !p.consentConfirmed) return null;
    if (!photos.has(p.id)) photos.set(p.id, await imageOf(p.assetId));
    const img = photos.get(p.id);
    return img ? { image: img, focalX: p.focalX, focalY: p.focalY } : null;
  };
  const work = await makeTempDir(`adw-video-${conceptId}`);
  try {
    // the voice: one narration per scene, placed at the scene's start
    const voiced: Array<{ file: string; at: number }> = [];
    if (voice && elevenLabsConfigured()) {
      for (const [i, { s, a }] of spans.entries()) {
        const text = (s.spokenText ?? "").trim();
        if (!text) continue;
        const id = await ensureNarration(text, { voiceId: project.voiceId, modelId: project.ttsModel, projectId });
        const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id } });
        const local = await toLocalFile(asset.storageKey);
        const file = path.join(work, `voice-${i}.mp3`);
        await fsp.copyFile(local.path, file);
        await local.cleanup();
        voiced.push({ file, at: a });
      }
    }
    const srtFile = path.join(work, "napisy.srt");
    await fsp.writeFile(srtFile, scenesToSrt(spans.map(({ s, a, b }) => ({ ...toAdAsset(s), startS: a, endS: b }))));
    const formats = (variants.length ? variants : [{ aspectRatio: "9:16", width: null, height: null } as (typeof variants)[number]]).map((v) => {
      const k = formatKeyOf(v.aspectRatio, v.width, v.height) ?? "portrait";
      return { ...PMAX_SPEC.videos.formats.find((f) => f.key === k)!, variantId: (v as { id?: string }).id ?? null };
    });
    const out: Array<{ variantId: string | null; key: string; assetId: string; width: number; height: number; duration: number; url: string }> = [];
    for (const f of formats) {
      // frames
      const list: string[] = [];
      for (const [i, { s, a, b }] of spans.entries()) {
        const canvas = createCanvas(f.width, f.height);
        const isCta = i === spans.length - 1 && spans.length > 1;
        drawSceneFrame(canvas.getContext("2d") as never, {
          width: f.width,
          height: f.height,
          theme,
          screenText: s.screenText || s.spokenText || "",
          visualBrief: s.visualBrief,
          sceneLabel: `Scena ${s.sceneIndex ?? i + 1}`,
          logo,
          photo: isCta || ((s.edit ?? {}) as AssetEdit).photoHidden ? null : await photoFor(s.expertPhotoKey, s.expertPhotoId),
          isCta,
        });
        const png = path.join(work, `${f.key}-${i}.png`);
        await fsp.writeFile(png, await canvas.encode("png"));
        list.push(`file '${png}'\nduration ${(b - a).toFixed(3)}`);
      }
      // the concat demuxer needs the last file once more
      list.push(`file '${path.join(work, `${f.key}-${spans.length - 1}.png`)}'`);
      const concat = path.join(work, `${f.key}.txt`);
      await fsp.writeFile(concat, list.join("\n"));
      const mp4 = path.join(work, `${f.key}.mp4`);
      const audioIn = voiced.length ? voiced.flatMap((v) => ["-i", v.file]) : ["-f", "lavfi", "-t", String(total), "-i", "anullsrc=r=48000:cl=stereo"];
      const audioFilter = voiced.length ? `${voiced.map((v, i) => `[${i + 2}:a]adelay=${Math.round(v.at * 1000)}|${Math.round(v.at * 1000)},aresample=48000[v${i}]`).join(";")};${voiced.map((_, i) => `[v${i}]`).join("")}amix=inputs=${voiced.length}:normalize=0,apad,atrim=0:${total}[a]` : `[2:a]atrim=0:${total}[a]`;
      await run(env.ffmpeg, [
        "-hide_banner", "-y",
        "-f", "concat", "-safe", "0", "-i", concat,
        "-i", srtFile,
        ...audioIn,
        "-filter_complex", `[0:v]fps=30,format=yuv420p[v];${audioFilter}`,
        "-map", "[v]", "-map", "[a]", "-map", "1:s",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "128k", "-ac", "2",
        "-c:s", "mov_text", "-metadata:s:s:0", "language=pol",
        "-t", String(total), "-movflags", "+faststart", mp4,
      ]);
      const info = await probe(mp4);
      const key = `projects/${projectId}/adwords/video/${conceptId}-${f.key}-${Date.now().toString(36)}.mp4`;
      const size = await putFile(key, mp4, "video/mp4");
      const name = `${slugify(project.name)}_${conceptId}_${f.key}_${f.width}x${f.height}.mp4`;
      const asset = await prisma.mediaAsset.create({ data: { kind: "RENDER", projectId, storageKey: key, mimeType: "video/mp4", sizeBytes: size, durationSec: info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio, hasVideo: true, originalName: name } });
      if (f.variantId) {
        const v = await prisma.adwordsAsset.findUniqueOrThrow({ where: { id: f.variantId } });
        await prisma.adwordsAsset.update({ where: { id: v.id }, data: { edit: { ...((v.edit ?? {}) as object), renderAssetId: asset.id, renderedAt: new Date().toISOString(), voiced: voiced.length > 0 } as Prisma.InputJsonValue } });
      }
      out.push({ variantId: f.variantId, key: f.key, assetId: asset.id, width: info.width ?? f.width, height: info.height ?? f.height, duration: info.duration, url: await signedUrl(key, { download: name }) });
    }
    return { conceptId, voiced: voiced.length > 0, files: out };
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}
