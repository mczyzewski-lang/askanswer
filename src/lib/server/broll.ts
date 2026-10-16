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
import { higgsfieldConfigured, openaiConfigured, openaiKeyDiagnostics } from "./env";
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
  kind: "video" | "infographic" | "illustration";
  start: number;
  end: number;
  duration: number;
  quote: string;
  title: string;
  reason: string;
  /** full text-to-video prompt (style + shots) */
  prompt: string;
  /** text-to-image prompt: the full-screen illustration of the thought (or an infographic background) */
  imagePrompt: string;
  infographic: InfographicContent;
  /** the surrounding passage of the answer (several sentences) the visual expresses */
  passage: string;
}

type RawSuggestion = Omit<BrollSuggestion, "id" | "passage"> & { passage?: string };

const SuggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        kind: z.enum(["illustration", "video", "infographic"]).describe("What fits this moment better"),
        start: z.number().describe("Timeline second where the visual starts"),
        end: z.number().describe("Timeline second where the visual ends"),
        duration: z.number().describe("Video clip length to generate: 5 or 10 seconds"),
        quote: z.string().describe("The exact words the expert says during this moment (Polish, verbatim from the transcript)"),
        title: z.string().describe("Short Polish label for the moment, max 6 words"),
        reason: z.string().describe("One Polish sentence: why this visual helps the viewer at this moment"),
        scene: z.string().describe("English: the video SHOT LIST (or, without a style, the full video prompt) for this moment"),
        illustration: z
          .string()
          .describe(
            "English, 40-90 words: a full-screen still illustration that shows the THOUGHT developed in the surrounding passage as one clear visual metaphor — subject, metaphor, composition, mood. It may carry minimal Polish text: one short headline (max 5 words) and up to 3 arrows with 1-3-word labels pointing at elements; give every text exactly, in «» quotes",
          ),
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
Pick the moments where a full-screen visual over the expert (their voice and the captions continue on top) makes the answer clearer.

Read the WHOLE answer first and find its 3 to 5 main thoughts. A thought is usually developed over several sentences (10-25 seconds of speech) — base every visual on the whole passage, never on a single sentence or a fragment of one. The visual appears while that thought is being said: 5 to 8 seconds, starting a second or two after the passage begins, aligned with sentence boundaries.

Kinds:
- "illustration" (the default): a full-screen illustration of the thought — a visual metaphor or situation that makes the idea instantly understandable (e.g. "the court decides only what you put in writing" → a judge's hand holding a magnifying glass over a document with empty, missing pages, headline «Liczy się tylko to, co napiszesz», an arrow to the empty page labelled «brak dowodu»). An illustration, not a slide: text only as a short headline and a few arrow labels.
- "infographic": ONLY when the expert actually gives figures, deadlines, amounts, numbered steps or a comparison worth reading.
- "video": a short AI video scene, for situations where motion matters.
Rules:
- Skip greetings, the first 2 seconds and the final call to action. Never overlap; keep at least 4 seconds of the expert on camera between moments.
- duration (video only): 5 for moments up to ~6 s, otherwise 10.
- Fill ALL fields for every moment (the editor may switch the kind).

Infographic (Polish, crisp and factual, only what the expert actually said — never invent figures): a short headline and 2-4 rows of key value + label.

${
  style
    ? `Video SCENE = a shot list only (the visual style is prepended automatically, do not repeat it). Use this exact format, one shot per ~2 seconds, covering exactly the clip duration:
"SHOT 1 0.0-2.0s WIDE front angle: <what happens, motion from frame one>. HARD CUT. SHOT 2 2.0-4.0s CU side angle: <...>. HARD CUT. ..."
Vary shot sizes (WIDE, MEDIUM, CU, ECU) and angles (front, side, low, high, top-down). Tell a small visual story of what the expert says through objects, rooms, hands and faceless silhouettes; recurring objects across shots. No readable text, no talking characters.
The visual style used for this video: ${style}
ILLUSTRATION = one still frame in the same style (do not repeat the style): the visual metaphor of the passage's thought, one strong focal subject in the middle of the frame.`
    : `Video SCENE = a complete English text-to-video prompt (40-90 words): one continuous cinematic shot with subject, setting, action, camera movement, lighting and mood; vertical 9:16 with the subject in the centre third; colour grade in the brand palette described in words; no readable text, logos or people speaking to camera; prefer hands, silhouettes, objects and environments.
ILLUSTRATION = a still image prompt for the visual metaphor of the passage's thought, one strong focal subject in the middle of the frame, in the brand palette.`
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
    if (end - start < 1.5 || (!s.prompt.trim() && !s.infographic.items.length && !s.imagePrompt.trim())) continue;
    const items = s.infographic.items.filter((i) => i.value.trim() || i.label.trim()).slice(0, 4);
    out.push({
      ...s,
      passage: s.passage ?? "",
      kind: s.kind === "infographic" && items.length ? "infographic" : s.kind !== "video" && s.imagePrompt.trim() ? "illustration" : "video",
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
/** Illustration of a thought: the scene + the theme colours spelled out + the minimal-text rule. */
export function composeIllustration(style: string | null, scene: string, theme: ThemeTokens) {
  const c = (hex: string) => `${colorName(hex)} (${hex})`;
  return [
    style ? `${style} Single still frame, vertical 9:16.` : "Vertical 9:16 still illustration.",
    scene.trim(),
    `Colours of the brand theme: background ${c(theme.background)}, main shapes ${c(theme.primary)} and ${c(theme.secondary)}, accents ${c(theme.accent)} and ${c(theme.highlight)}, text and light details ${c(theme.text)}.`,
    "Minimal text allowed, in Polish: one short headline (max 5 words) that sums up the thought, and up to 3 thin arrows with 1-3-word labels pointing at the key elements — clean, sparse and legible. No other text, no logos.",
  ].join(" ");
}

function composeImage(style: string | null, scene: string) {
  return style ? `${style} Single still illustration frame, vertical 9:16, one strong focal subject. ${scene.trim()}` : `${scene.trim()} Vertical 9:16 still image, one strong focal subject, no text, no logos.`;
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
  return response.parsed_output.suggestions.map(({ scene, illustration, ...s }) => ({ ...s, prompt: compose(style, scene), imagePrompt: s.kind === "illustration" ? composeIllustration(style, illustration, theme) : composeImage(style, illustration) }));
}

/** Consecutive sentences grouped into passages of ~10–20 s (one thought each, roughly). */
export function passages(segments: SpokenSegment[], duration: number): SpokenSegment[] {
  const inside = segments.filter((s) => s.t1 > 2 && s.t0 < duration - 1);
  const out: SpokenSegment[] = [];
  let cur: SpokenSegment | null = null;
  for (const s of inside) {
    if (cur && (s.t1 - cur.t0 > 20 || (cur.t1 - cur.t0 >= 10 && /[.!?…]$/.test(cur.text.trim())))) {
      out.push(cur);
      cur = null;
    }
    cur = cur ? { t0: cur.t0, t1: s.t1, text: `${cur.text} ${s.text}` } : { ...s };
  }
  if (cur) out.push(cur);
  return out;
}

/** The answer around a moment (±8 s, whole sentences): what the visual should express. */
export function passageFor(segments: SpokenSegment[], start: number, end: number): string {
  return segments
    .filter((s) => s.t1 > start - 8 && s.t0 < end + 8)
    .map((s) => s.text)
    .join(" ")
    .slice(0, 1500);
}

/**
 * Without an Anthropic key: the answer split into passages; the richest ones, spread over the
 * video, become illustrations of what is said there (OpenAI reads the Polish passage itself).
 */
function suggestHeuristic(segments: SpokenSegment[], theme: ThemeTokens, duration: number, style: string | null, illustrate: boolean): RawSuggestion[] {
  const all = passages(segments, duration);
  const usable = all.filter((p) => p.text.split(/\s+/).length >= 8);
  const pool = usable.length ? usable : all.length ? all : segments;
  const picked: SpokenSegment[] = [];
  for (const p of [...pool].sort((x, y) => y.text.length - x.text.length)) {
    if (picked.length >= 4) break;
    if (picked.some((q) => Math.abs(q.t0 - p.t0) < 8)) continue;
    picked.push(p);
  }
  picked.sort((x, y) => x.t0 - y.t0);
  return picked.map((p, i) => {
    const words = p.text.split(/\s+/);
    const parts = p.text.split(/[,;:.]| i | oraz /).map((x) => x.trim()).filter((x) => x.length > 2).slice(0, 3);
    const scene = style
      ? `SHOT 1 0.0-2.0s WIDE front angle: a quiet room that illustrates "${p.text.slice(0, 300)}", motion from frame one. HARD CUT. SHOT 2 2.0-4.0s CU side angle: hands and objects related to it. HARD CUT. SHOT 3 4.0-5.0s MEDIUM high angle: a faceless silhouette reacts.`
      : `Cinematic vertical 9:16 B-roll shot, slow push-in, soft natural light, shallow depth of field, calm premium mood. Visual metaphor for: "${p.text.slice(0, 300)}". Colour grade in ${colorName(theme.primary)} and ${colorName(theme.accent)} tones. No text, no logos, no faces looking at camera.`;
    const start = Math.min(p.t1 - 2, p.t0 + Math.min(1.5, (p.t1 - p.t0) / 4));
    return {
      kind: illustrate ? ("illustration" as const) : i % 2 === 1 ? ("infographic" as const) : ("video" as const),
      start,
      end: Math.min(p.t1, start + 7),
      duration: 5,
      quote: p.text.length > 220 ? `${p.text.slice(0, 217)}…` : p.text,
      title: words.slice(0, 5).join(" "),
      reason: "Ilustracja myśli z tego fragmentu wypowiedzi (tryb podstawowy — dodaj ANTHROPIC_API_KEY, aby AI samo wybierało najważniejsze myśli i metafory).",
      prompt: compose(style, scene),
      imagePrompt: illustrate
        ? composeIllustration(style, "One clear visual metaphor of the main thought the expert expresses in this passage — what it means for the viewer, one strong focal subject.", theme)
        : composeImage(style, `A calm scene that illustrates: "${p.text.slice(0, 200)}"`),
      infographic: { headline: words.slice(0, 6).join(" "), items: (parts.length ? parts : [p.text]).map((x, k) => ({ value: `${k + 1}.`, label: x.split(/\s+/).slice(0, 9).join(" ") })), note: null },
      passage: p.text,
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
  const illustrate = openaiConfigured() || higgsfieldConfigured();
  // every visual carries the longer passage it expresses (verbatim from the transcript)
  const withPassages = (list: BrollSuggestion[]) =>
    list.map((x) => {
      // at least the neighbouring sentences: a short passage alone carries too little of the thought
      // (a passage of its own is kept: overlapping context would make every moment the same picture)
      if ((x.passage?.length ?? 0) >= 160) return x;
      const around = passageFor(segments, x.start, x.end);
      return { ...x, passage: (x.passage?.length ?? 0) >= around.length ? x.passage : around };
    });
  const basic = () => withPassages(sanitize(suggestHeuristic(segments, theme, duration, style, illustrate), duration));
  if (env.anthropicConfigured) {
    try {
      return { suggestions: withPassages(sanitize(await suggestWithClaude(question, segments, theme, duration, style), duration)), engine: "claude", styled: !!style, warning: null as string | null };
    } catch (e) {
      // automatic run: a Claude problem (key, quota) must not stop the visuals
      if (!opts.fallback) throw e;
      return { suggestions: basic(), engine: "basic", styled: !!style, warning: `Claude: ${(e as Error).message}` };
    }
  }
  return { suggestions: basic(), engine: "basic", styled: !!style, warning: null as string | null };
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

/**
 * Full-screen illustration of a thought (OpenAI): drawn from the whole passage the expert says,
 * in the brand colours and the category style, no text (the captions are laid over it).
 */
export function illustrationPrompt(
  p: { imagePrompt: string; passage: string; question?: string | null; focus?: string | null; others?: string[] | null },
  theme: ThemeTokens,
  styled: boolean,
) {
  const c = (hex: string) => `${colorName(hex)} (${hex})`;
  return [
    "Full-screen vertical 9:16 illustration for a short expert video (TikTok/Reels). It is shown over the whole frame while the expert says the passage below, with the captions laid over it — it must make the expert's THOUGHT instantly understandable, as an illustration of the idea, not a slide or a chart.",
    p.question ? `Viewer's question (Polish): «${p.question}»` : "",
    p.passage ? `What the expert says at this moment (Polish): «${p.passage}»` : "",
    p.focus && p.focus !== p.passage ? `The key sentence of THIS moment — illustrate exactly this thought (Polish): «${p.focus}»` : "",
    `Visual idea: ${p.imagePrompt}`,
    p.others?.length
      ? `The same video shows other illustrations for these thoughts: ${p.others.map((o) => `«${o}»`).join("; ")}. Make this one clearly different from them — another metaphor, other objects, another scene and composition, another headline.`
      : "",
    "Composition: one clear focal visual metaphor, readable on a phone within a second; the key subject in the middle of the frame (between 25% and 65% of the height); the top 20% and the bottom 30% quieter (a title and captions are placed there), but the artwork fills the whole frame edge to edge — no cards, borders, panels or frames.",
    `Colours — use exactly this brand palette and nothing far from it: background ${c(theme.background)}, main shapes ${c(theme.primary)} and ${c(theme.secondary)}, accents and arrows ${c(theme.accent)} and ${c(theme.highlight)}, text and light details ${c(theme.text)}.`,
    "Text: minimal, only in Polish with correct letters (ą ć ę ł ń ó ś ź ż), taken from what the expert says — at most one short headline (max 5 words) in the upper-middle area and up to 3 thin arrows or callout lines with 1-3-word labels pointing at elements; large and legible on a phone; no paragraphs, no other words, nothing in the bottom 30% (captions), no logos or watermarks.",
    "No realistic portraits of real people; faceless or stylised figures only.",
    styled ? "" : "Style: premium modern editorial illustration, bold simple shapes, soft depth and light grain, high contrast.",
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
    /** "template" = text rendered by the app; "openai" = the whole image drawn by OpenAI; "illustration" = full-screen illustration of the thought, no text */
    engine?: "template" | "openai" | "illustration";
    /** illustration: the passage of the answer it expresses + a short name for the layer */
    passage?: string | null;
    title?: string | null;
    /** illustration: the key sentence of this moment, and the thoughts other illustrations in the video show */
    focus?: string | null;
    others?: string[] | null;
    /** illustration: how many variants to draw for choosing (default ILLUSTRATION_VARIANTS) */
    variants?: number;
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
    if (p.engine === "illustration") {
      const style = await styleFor(comp, theme);
      const question = comp.questionId ? (await prisma.question.findUnique({ where: { id: comp.questionId }, select: { text: true } }))?.text : null;
      const n = Math.max(1, Math.min(4, p.variants ?? env.illustrationVariants));
      const raws = Array.from({ length: n }, (_, i) => path.join(dir, `illustration-src-${i}.png`));
      const prompt = illustrationPrompt({ imagePrompt: p.imagePrompt ?? "", passage: p.passage ?? "", question, focus: p.focus, others: p.others }, theme, !!style);
      let got = 1;
      const raw = raws[0];
      if (openaiConfigured()) got = await generateOpenAIImage(prompt, { width: W, height: H, out: raws });
      else if (higgsfieldConfigured()) {
        let requestId = p.requestId;
        if (!requestId) {
          requestId = await submitImage(prompt.slice(0, 2900), W >= H ? (W === H ? "1:1" : "16:9") : "9:16");
          await prisma.job.update({ where: { id: jobId }, data: { payload: { ...p, requestId } as unknown as Prisma.InputJsonValue } });
        }
        await downloadFile(await waitForImage(requestId), raw);
      } else throw new Error(`Ilustracje wymagają klucza OpenAI. ${openaiKeyDiagnostics()}`);
      // every variant becomes its own image asset; the first one goes on the timeline, the others can be picked in the Studio
      const variantIds: string[] = [];
      for (let i = 0; i < got; i++) {
        const file = path.join(dir, `illustration-${i}.png`);
        await coverTo(raws[i], file, W, H);
        const v = await storeInfographic(comp.projectId, file, W, H, p.title || p.infographic.headline, { engine: "illustration", imageSource: openaiConfigured() ? "openai" : "higgsfield", variant: String(i + 1) }, null, "Ilustracja");
        variantIds.push(v.assetId);
      }
      return { assetId: variantIds[0], variantIds, warning: null as string | null };
    }
    if (p.engine === "openai") {
      // whole infographic by OpenAI, fitted (cover) to the video frame
      const raw = path.join(dir, "openai.png");
      await generateOpenAIImage(openaiInfographicPrompt(p.infographic, theme, await styleFor(comp, theme)), { width: W, height: H, out: raw });
      await coverTo(raw, out, W, H);
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

/** Fit (cover) a generated image to the video frame. */
async function coverTo(src: string, out: string, W: number, H: number) {
  const img = await loadImage(await fsp.readFile(src));
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");
  const sc = Math.max(W / img.width, H / img.height);
  ctx.drawImage(img, (W - img.width * sc) / 2, (H - img.height * sc) / 2, img.width * sc, img.height * sc);
  await fsp.writeFile(out, await cv.encode("png"));
}

async function storeInfographic(projectId: string, file: string, W: number, H: number, headline: string, meta: Record<string, string>, warning: string | null, label = "Infografika") {
  const key = `projects/${projectId}/uploads/${randomToken(12)}.png`;
  const size = await putFile(key, file, "image/png");
  const asset = await prisma.mediaAsset.create({
    data: { kind: "IMAGE", projectId, storageKey: key, mimeType: "image/png", sizeBytes: size, width: W, height: H, hasAudio: false, hasVideo: true, originalName: `${label}: ${headline}`.slice(0, 120), meta: { source: "infographic", ...meta } },
  });
  return { assetId: asset.id, warning };
}
