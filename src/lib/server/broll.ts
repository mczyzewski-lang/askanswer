import fsp from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { generateOpenAIImage, OpenAIImageError } from "./openai-images";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { env } from "./env";
import { makeTempDir } from "./storage";
import { ingestOverlayVideo } from "./uploads";
import { downloadFile, HiggsfieldError, submitImage, submitVideo, waitForImage, waitForVideo, videoModel } from "./higgsfield";
import { renderInfographic, type InfographicData } from "./infographic";
import { colorName, fillStyle } from "../broll-style";
import { putFile } from "./storage";
import { randomToken } from "./crypto";
import { higgsfieldConfigured } from "./env";
import type { ThemeTokens } from "../editor/types";
import { themeFromRow } from "../themes";

/** One spoken sentence in TIMELINE seconds (what the viewer hears at that moment). */
export interface SpokenSegment {
  t0: number;
  t1: number;
  text: string;
}

export interface InfographicContent {
  headline: string;
  items: Array<{ value: string; label: string }>;
  note: string | null;
}

export interface BrollSuggestion {
  id: string;
  kind: "video" | "infographic";
  start: number;
  end: number;
  duration: number;
  quote: string;
  title: string;
  reason: string;
  /** full text-to-video prompt (style + shots) */
  prompt: string;
  /** text-to-image prompt for the infographic's background illustration */
  imagePrompt: string;
  infographic: InfographicContent;
}

type RawSuggestion = Omit<BrollSuggestion, "id">;

const SuggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        kind: z.enum(["video", "infographic"]).describe("What fits this moment better"),
        start: z.number().describe("Timeline second where the visual starts"),
        end: z.number().describe("Timeline second where the visual ends"),
        duration: z.number().describe("Video clip length to generate: 5 or 10 seconds"),
        quote: z.string().describe("The exact words the expert says during this moment (Polish, verbatim from the transcript)"),
        title: z.string().describe("Short Polish label for the moment, max 6 words"),
        reason: z.string().describe("One Polish sentence: why this visual helps the viewer at this moment"),
        scene: z.string().describe("English: the video SHOT LIST (or, without a style, the full video prompt) for this moment"),
        illustration: z.string().describe("English: one still illustration for the infographic background, no text"),
        infographic: z.object({
          headline: z.string().describe("Polish headline, max 7 words"),
          items: z.array(z.object({ value: z.string().describe("Short key figure or step, e.g. '6–12 mies.', '50%', 'Krok 1'"), label: z.string().describe("Polish, max 9 words") })).describe("2 to 4 rows"),
          note: z.string().nullable().describe("Optional short Polish footnote, or null"),
        }),
      }),
    )
    .describe("3 to 6 moments in chronological order, never overlapping"),
});

function system(style: string | null) {
  return `You are a video editor for short vertical (9:16) expert videos on TikTok, Reels and Shorts.
An expert (often a lawyer, therapist or business coach) answers a viewer's question to camera in Polish.
Pick the moments where a full-screen visual over the expert (their voice continues) makes the answer clearer: either an AI-generated video scene or an infographic.

Choosing moments:
- Propose 3 to 6 moments, each 4 to 10 seconds, inside the transcript's time range and aligned with sentence boundaries. Skip greetings, the first 2 seconds and the final call to action.
- Never overlap; keep at least 4 seconds of the expert on camera between moments.
- kind "infographic" when the expert gives numbers, deadlines, amounts, steps, lists, conditions or comparisons; kind "video" for situations, emotions, places and metaphors. Alternate the kinds where the content allows, and include at least one infographic when anything list-like or numeric is said.
- duration: 5 for moments up to ~6 s, otherwise 10.
- Fill BOTH the video fields and the infographic fields for every moment (the editor may switch the kind).

Infographic (Polish, crisp and factual, only what the expert actually said — never invent figures): a short headline and 2-4 rows of key value + label.

${
  style
    ? `Video SCENE = a shot list only (the visual style is prepended automatically, do not repeat it). Use this exact format, one shot per ~2 seconds, covering exactly the clip duration:
"SHOT 1 0.0-2.0s WIDE front angle: <what happens, motion from frame one>. HARD CUT. SHOT 2 2.0-4.0s CU side angle: <...>. HARD CUT. ..."
Vary shot sizes (WIDE, MEDIUM, CU, ECU) and angles (front, side, low, high, top-down). Tell a small visual story of what the expert says through objects, rooms, hands and faceless silhouettes; recurring objects across shots. No readable text, no talking characters.
The visual style used for this video: ${style}
ILLUSTRATION = one still frame in the same style, a calm scene related to the moment, uncluttered in the centre.`
    : `Video SCENE = a complete English text-to-video prompt (40-90 words): one continuous cinematic shot with subject, setting, action, camera movement, lighting and mood; vertical 9:16 with the subject in the centre third; colour grade in the brand palette described in words; no readable text, logos or people speaking to camera; prefer hands, silhouettes, objects and environments.
ILLUSTRATION = a matching still image prompt, calm and uncluttered in the centre.`
}

Write "title", "reason" and the infographic in Polish. "quote" must be copied verbatim from the transcript.`;
}

function themeLine(t: ThemeTokens) {
  return `Brand palette — primary ${colorName(t.primary)}, accent ${colorName(t.accent)}, secondary ${colorName(t.secondary)}, highlight ${colorName(t.highlight)}, background ${colorName(t.background)}.`;
}

function transcriptText(segments: SpokenSegment[]) {
  return segments.map((s) => `[${s.t0.toFixed(1)}–${s.t1.toFixed(1)}] ${s.text}`).join("\n");
}

/** Clamp, sort and de-overlap model output so the UI can trust it. */
export function sanitize(list: RawSuggestion[], duration: number): BrollSuggestion[] {
  const out: BrollSuggestion[] = [];
  for (const s of [...list].sort((a, b) => a.start - b.start)) {
    let start = Math.max(0, Math.min(s.start, duration - 1));
    let end = Math.min(duration, Math.max(s.end, start + 2));
    const prev = out[out.length - 1];
    if (prev && start < prev.end + 1) start = prev.end + 1;
    if (end - start > 10) end = start + 10;
    if (end - start < 1.5 || (!s.prompt.trim() && !s.infographic.items.length)) continue;
    const items = s.infographic.items.filter((i) => i.value.trim() || i.label.trim()).slice(0, 4);
    out.push({
      ...s,
      kind: s.kind === "infographic" && items.length ? "infographic" : "video",
      duration: s.duration > 7 ? 10 : 5,
      infographic: { headline: s.infographic.headline.slice(0, 120), items, note: s.infographic.note?.trim() || null },
      id: `sug_${out.length}_${Math.round(start * 10)}`,
      start: Math.round(start * 10) / 10,
      end: Math.round(end * 10) / 10,
    });
  }
  return out.slice(0, 6);
}

function compose(style: string | null, scene: string) {
  return style ? `${style} ${scene.trim()}` : scene.trim();
}
function composeImage(style: string | null, scene: string) {
  return style ? `${style} Single still illustration frame, vertical 9:16, calm uncluttered centre. ${scene.trim()}` : `${scene.trim()} Vertical 9:16 still image, calm uncluttered centre, no text, no logos.`;
}

async function suggestWithClaude(question: string, segments: SpokenSegment[], theme: ThemeTokens, duration: number, style: string | null): Promise<RawSuggestion[]> {
  const client = new Anthropic(env.anthropicKey ? { apiKey: env.anthropicKey } : {});
  const response = await client.beta.messages.parse({
    model: env.claudeModel,
    max_tokens: 16000,
    output_config: { effort: "medium", format: betaZodOutputFormat(SuggestionSchema) },
    // server-side refusal fallback: if the model declines, the API reroutes the same request
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: system(style),
    messages: [
      {
        role: "user",
        content: `Viewer's question: ${question || "(none)"}\nVideo length: ${duration.toFixed(1)} s\n${themeLine(theme)}\n\nTranscript of the expert's answer (timeline seconds):\n${transcriptText(segments)}`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("Model odmówił przygotowania propozycji dla tego nagrania.");
  if (!response.parsed_output) throw new Error("Nie udało się odczytać propozycji AI — spróbuj ponownie.");
  return response.parsed_output.suggestions.map(({ scene, illustration, ...s }) => ({ ...s, prompt: compose(style, scene), imagePrompt: composeImage(style, illustration) }));
}

/** Without an Anthropic key: longest sentences, spread out, alternating video / infographic, templated prompts. */
function suggestHeuristic(segments: SpokenSegment[], theme: ThemeTokens, duration: number, style: string | null): RawSuggestion[] {
  const inside = segments.filter((s) => s.t0 > 1 && s.t1 < duration - 0.5);
  const wordy = inside.filter((s) => s.text.split(/\s+/).length >= 4);
  const usable = wordy.length ? wordy : inside.length ? inside : segments;
  const picked: SpokenSegment[] = [];
  for (const s of [...usable].sort((a, b) => b.text.length - a.text.length)) {
    if (picked.length >= 4) break;
    if (picked.some((p) => Math.abs(p.t0 - s.t0) < 6)) continue;
    picked.push(s);
  }
  picked.sort((a, b) => a.t0 - b.t0);
  return picked.map((s, i) => {
    const words = s.text.split(/\s+/);
    const parts = s.text.split(/[,;:]| i | oraz /).map((x) => x.trim()).filter((x) => x.length > 2).slice(0, 3);
    const scene = style
      ? `SHOT 1 0.0-2.0s WIDE front angle: a quiet room that illustrates "${s.text}", motion from frame one. HARD CUT. SHOT 2 2.0-4.0s CU side angle: hands and objects related to it. HARD CUT. SHOT 3 4.0-5.0s MEDIUM high angle: a faceless silhouette reacts.`
      : `Cinematic vertical 9:16 B-roll shot, slow push-in, soft natural light, shallow depth of field, calm premium mood. Visual metaphor for: "${s.text}". Colour grade in ${colorName(theme.primary)} and ${colorName(theme.accent)} tones. No text, no logos, no faces looking at camera.`;
    return {
      kind: i % 2 === 1 ? ("infographic" as const) : ("video" as const),
      start: s.t0,
      end: Math.min(s.t1, s.t0 + 6),
      duration: 5,
      quote: s.text,
      title: words.slice(0, 5).join(" "),
      reason: "Ilustracja tego, o czym ekspert mówi w tym zdaniu (tryb podstawowy — dodaj ANTHROPIC_API_KEY, aby AI dobierało sceny i treść infografik).",
      prompt: compose(style, scene),
      imagePrompt: composeImage(style, `A calm scene that illustrates: "${s.text}"`),
      infographic: { headline: words.slice(0, 6).join(" "), items: (parts.length ? parts : [s.text]).map((p, k) => ({ value: `${k + 1}.`, label: p.split(/\s+/).slice(0, 9).join(" ") })), note: null },
    };
  });
}

/** Visual style for this video: the question's category, else the theme default; colours filled from the theme. */
async function styleFor(comp: { questionId: string | null; project: { theme: { brollStyle: string | null } | null } }, theme: ThemeTokens) {
  const q = comp.questionId ? await prisma.question.findUnique({ where: { id: comp.questionId }, select: { category: { select: { brollStyle: true } } } }) : null;
  const raw = q?.category?.brollStyle ?? comp.project.theme?.brollStyle ?? null;
  return raw?.trim() ? fillStyle(raw.trim(), theme) : null;
}

export async function suggestBroll(compositionId: string, segments: SpokenSegment[], duration: number, opts: { fallback?: boolean } = {}) {
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id: compositionId }, include: { project: { include: { theme: true } }, question: true } });
  const doc = comp.document as unknown as { theme: ThemeTokens; meta?: { questionText?: string } };
  const theme = comp.project.theme ? themeFromRow(comp.project.theme) : doc.theme;
  if (!segments.length) throw new Error("Brak transkrypcji — najpierw wygeneruj napisy, żeby AI wiedziało, o czym mówi ekspert.");
  const question = comp.question?.text ?? doc.meta?.questionText ?? "";
  const style = await styleFor(comp, theme);
  if (env.anthropicConfigured) {
    try {
      return { suggestions: sanitize(await suggestWithClaude(question, segments, theme, duration, style), duration), engine: "claude", styled: !!style, warning: null as string | null };
    } catch (e) {
      // automatic run: a Claude problem (key, quota) must not stop the infographics
      if (!opts.fallback) throw e;
      return { suggestions: sanitize(suggestHeuristic(segments, theme, duration, style), duration), engine: "basic", styled: !!style, warning: `Claude: ${(e as Error).message}` };
    }
  }
  return { suggestions: sanitize(suggestHeuristic(segments, theme, duration, style), duration), engine: "basic", styled: !!style, warning: null as string | null };
}

/**
 * Worker: generate one clip with Higgsfield and store it as a video layer asset. The request id is
 * saved on the job before polling, so a retry (worker restart, deploy) resumes the same generation
 * instead of paying for a second one.
 */
export async function generateBroll(jobId: string, p: { compositionId: string; prompt: string; duration: number; model: string; aspect: "9:16" | "16:9" | "1:1"; requestId?: string }) {
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id: p.compositionId }, select: { projectId: true } });
  let requestId = p.requestId;
  if (!requestId) {
    requestId = await submitVideo(p.prompt, p.model, p.duration, p.aspect);
    await prisma.job.update({ where: { id: jobId }, data: { payload: { ...p, requestId } } });
  }
  const url = await waitForVideo(requestId);
  const dir = await makeTempDir("broll");
  try {
    const file = path.join(dir, "higgsfield.mp4");
    await downloadFile(url, file);
    const asset = await ingestOverlayVideo(file, dir, comp.projectId, `AI: ${p.prompt.slice(0, 60)}`, { source: "higgsfield", model: videoModel(p.model).id, requestId });
    return { assetId: asset.id, requestId };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/**
 * Worker: infographic image — optional Higgsfield illustration in the category style as the
 * background, then crisp text rendered with the theme fonts. An illustration failure does not
 * lose the infographic: it is rendered on the theme background and the warning is returned.
 */
/** Prompt for a complete infographic drawn by OpenAI (text included), in the theme colours and category style. */
export function openaiInfographicPrompt(info: InfographicData, theme: ThemeTokens, style: string | null) {
  const c = (hex: string) => `${colorName(hex)} (${hex})`;
  const rows = info.items.map((r, i) => `${i + 1}. big value «${r.value}» — label «${r.label}»`).join("\n");
  return [
    "Vertical 9:16 infographic for a short expert video on TikTok/Reels.",
    "Language: Polish. Render every text exactly as written below, with correct Polish letters (ą ć ę ł ń ó ś ź ż); add no other words.",
    `Headline: «${info.headline}»`,
    `Rows:\n${rows}`,
    info.note ? `Small footnote: «${info.note}»` : "",
    "Layout: keep the top 22% and the bottom 32% of the image calm, without text (the video title and captions are placed there). Put the infographic card with all text in the middle band, large and legible on a phone.",
    `Brand colours: background ${c(theme.background)}, card ${c(theme.primary)}, highlights ${c(theme.accent)} and ${c(theme.highlight)}, text ${c(theme.text)}.`,
    "Clean, modern, premium design with simple icons; high contrast; no logos, no watermarks, no people's faces.",
    style ? `Visual style of the illustration elements (as a still image): ${style}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateInfographic(
  jobId: string,
  p: {
    compositionId: string;
    infographic: InfographicData;
    imagePrompt?: string | null;
    /** background illustration source (template engine) */
    illustration?: "none" | "higgsfield" | "openai";
    /** "template" = text rendered by the app; "openai" = the whole image drawn by OpenAI */
    engine?: "template" | "openai";
    requestId?: string;
    width?: number;
    height?: number;
  },
) {
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id: p.compositionId }, include: { project: { include: { theme: true } } } });
  const theme = comp.project.theme ? themeFromRow(comp.project.theme) : (comp.document as unknown as { theme: ThemeTokens }).theme;
  const W = p.width ?? 1080;
  const H = p.height ?? 1920;
  const illustration = p.illustration ?? (p.imagePrompt ? "higgsfield" : "none");
  const dir = await makeTempDir("infographic");
  try {
    let background: string | null = null;
    let warning: string | null = null;
    const out = path.join(dir, "infographic.png");
    if (p.engine === "openai") {
      // whole infographic by OpenAI, fitted (cover) to the video frame
      const raw = path.join(dir, "openai.png");
      await generateOpenAIImage(openaiInfographicPrompt(p.infographic, theme, await styleFor(comp, theme)), { width: W, height: H, out: raw });
      const img = await loadImage(await fsp.readFile(raw));
      const cv = createCanvas(W, H);
      const ctx = cv.getContext("2d");
      const sc = Math.max(W / img.width, H / img.height);
      ctx.drawImage(img, (W - img.width * sc) / 2, (H - img.height * sc) / 2, img.width * sc, img.height * sc);
      await fsp.writeFile(out, await cv.encode("png"));
      return await storeInfographic(comp.projectId, out, W, H, p.infographic.headline, { engine: "openai" }, "Grafika z OpenAI — sprawdź pisownię tekstu przed eksportem.");
    }
    if (p.imagePrompt && illustration === "openai") {
      try {
        background = path.join(dir, "illustration.png");
        await generateOpenAIImage(p.imagePrompt, { width: W, height: H, out: background, quality: "medium" });
      } catch (e) {
        if (e instanceof OpenAIImageError && e.retryable) throw e;
        background = null;
        warning = `Ilustracja OpenAI nie powstała (${(e as Error).message}) — infografika ma tło z motywu.`;
      }
    }
    if (p.imagePrompt && illustration === "higgsfield" && higgsfieldConfigured()) {
      try {
        let requestId = p.requestId;
        if (!requestId) {
          const aspect = (p.width ?? 1080) >= (p.height ?? 1920) ? ((p.width ?? 1080) === (p.height ?? 1920) ? "1:1" : "16:9") : "9:16";
          requestId = await submitImage(p.imagePrompt, aspect);
          await prisma.job.update({ where: { id: jobId }, data: { payload: { ...p, requestId } as unknown as Prisma.InputJsonValue } });
        }
        background = path.join(dir, "illustration");
        await downloadFile(await waitForImage(requestId), background);
      } catch (e) {
        if (e instanceof HiggsfieldError && e.retryable) throw e; // transient: retry the job (resumes the same request)
        background = null;
        warning = `Ilustracja AI nie powstała (${(e as Error).message}) — infografika ma tło z motywu.`;
      }
    }
    await renderInfographic(p.infographic, theme, out, { width: W, height: H, background });
    return await storeInfographic(comp.projectId, out, W, H, p.infographic.headline, { engine: "template", illustration: background ? illustration : "none" }, warning);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

async function storeInfographic(projectId: string, file: string, W: number, H: number, headline: string, meta: Record<string, string>, warning: string | null) {
  const key = `projects/${projectId}/uploads/${randomToken(12)}.png`;
  const size = await putFile(key, file, "image/png");
  const asset = await prisma.mediaAsset.create({
    data: { kind: "IMAGE", projectId, storageKey: key, mimeType: "image/png", sizeBytes: size, width: W, height: H, hasAudio: false, hasVideo: true, originalName: `Infografika: ${headline}`.slice(0, 120), meta: { source: "infographic", ...meta } },
  });
  return { assetId: asset.id, warning };
}
