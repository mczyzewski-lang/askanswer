import fsp from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { prisma } from "./db";
import { env } from "./env";
import { makeTempDir } from "./storage";
import { ingestOverlayVideo } from "./uploads";
import { downloadVideo, submitVideo, waitForVideo, videoModel } from "./higgsfield";
import type { ThemeTokens } from "../editor/types";
import { themeFromRow } from "../themes";

/** One spoken sentence in TIMELINE seconds (what the viewer hears at that moment). */
export interface SpokenSegment {
  t0: number;
  t1: number;
  text: string;
}

export interface BrollSuggestion {
  id: string;
  start: number;
  end: number;
  quote: string;
  title: string;
  reason: string;
  prompt: string;
}

const SuggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        start: z.number().describe("Timeline second where the B-roll starts"),
        end: z.number().describe("Timeline second where the B-roll ends"),
        quote: z.string().describe("The exact words the expert says during this moment (Polish, verbatim from the transcript)"),
        title: z.string().describe("Short Polish label for the scene, max 6 words"),
        reason: z.string().describe("One Polish sentence: why this visual helps the viewer at this moment"),
        prompt: z.string().describe("English text-to-video prompt for the scene"),
      }),
    )
    .describe("3 to 5 B-roll moments in chronological order, never overlapping"),
});

const SYSTEM = `You are a video editor for short vertical (9:16) expert videos on TikTok, Reels and Shorts.
An expert (often a lawyer or other professional) answers a viewer's question to camera in Polish.
Your job: pick the moments where a short AI-generated B-roll clip, shown full-screen over the expert while their voice continues, would make the answer clearer or more engaging, and write a text-to-video prompt for each.

Choosing moments:
- Propose 3 to 5 moments. Each lasts 3 to 8 seconds and must lie inside the transcript's time range, aligned with sentence boundaries where possible.
- Pick concrete, visualisable ideas: objects, places, documents, situations, metaphors for what is being said. Skip greetings, the first 2 seconds and the final call to action.
- Never overlap moments and keep at least 4 seconds of the expert on camera between them.

Writing each prompt (English, 40-90 words):
- Describe one continuous cinematic shot: subject, setting, action, camera movement (slow push-in, gentle dolly, rack focus...), lighting and mood.
- Vertical 9:16 composition with the main subject in the centre third (the top and bottom of the frame carry captions).
- Colour grade it in the brand palette you are given, describing the colours in words (e.g. "deep navy shadows with warm amber highlights"), not as hex codes.
- No readable text, letters, numbers, logos, watermarks or UI. No people speaking to camera and no recognisable real people. Prefer hands, silhouettes, objects and environments over faces.
- Keep it realistic, calm and premium: this is professional content, not an advert.

Write "title" and "reason" in Polish. "quote" must be copied verbatim from the transcript.`;

function themeLine(t: ThemeTokens) {
  return `Brand palette — primary ${t.primary}, accent ${t.accent}, secondary ${t.secondary}, highlight ${t.highlight}, background ${t.background}.`;
}

function transcriptText(segments: SpokenSegment[]) {
  return segments.map((s) => `[${s.t0.toFixed(1)}–${s.t1.toFixed(1)}] ${s.text}`).join("\n");
}

/** Clamp, sort and de-overlap model output so the UI can trust it. */
export function sanitize(list: Array<Omit<BrollSuggestion, "id">>, duration: number): BrollSuggestion[] {
  const out: BrollSuggestion[] = [];
  for (const s of [...list].sort((a, b) => a.start - b.start)) {
    let start = Math.max(0, Math.min(s.start, duration - 1));
    let end = Math.min(duration, Math.max(s.end, start + 2));
    const prev = out[out.length - 1];
    if (prev && start < prev.end + 1) start = prev.end + 1;
    if (end - start > 10) end = start + 10;
    if (end - start < 1.5 || !s.prompt.trim()) continue;
    out.push({ ...s, id: `sug_${out.length}_${Math.round(start * 10)}`, start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10 });
  }
  return out.slice(0, 6);
}

async function suggestWithClaude(question: string, segments: SpokenSegment[], theme: ThemeTokens, duration: number) {
  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: env.claudeModel,
    max_tokens: 16000,
    output_config: { effort: "medium", format: betaZodOutputFormat(SuggestionSchema) },
    // server-side refusal fallback: if the model declines, the API reroutes the same request
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Viewer's question: ${question || "(none)"}\nVideo length: ${duration.toFixed(1)} s\n${themeLine(theme)}\n\nTranscript of the expert's answer (timeline seconds):\n${transcriptText(segments)}`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("Model odmówił przygotowania propozycji dla tego nagrania.");
  if (!response.parsed_output) throw new Error("Nie udało się odczytać propozycji AI — spróbuj ponownie.");
  return response.parsed_output.suggestions;
}

/** Without an Anthropic key: pick the longest sentences, spread out, with a templated prompt. */
function suggestHeuristic(segments: SpokenSegment[], theme: ThemeTokens, duration: number) {
  const inside = segments.filter((s) => s.t0 > 1 && s.t1 < duration - 0.5);
  const wordy = inside.filter((s) => s.text.split(/\s+/).length >= 4);
  const usable = wordy.length ? wordy : inside.length ? inside : segments;
  const picked: SpokenSegment[] = [];
  for (const s of [...usable].sort((a, b) => b.text.length - a.text.length)) {
    if (picked.length >= 4) break;
    if (picked.some((p) => Math.abs(p.t0 - s.t0) < 6)) continue;
    picked.push(s);
  }
  return picked.map((s) => ({
    start: s.t0,
    end: Math.min(s.t1, s.t0 + 6),
    quote: s.text,
    title: s.text.split(/\s+/).slice(0, 5).join(" "),
    reason: "Ilustracja tego, o czym ekspert mówi w tym zdaniu (tryb podstawowy — dodaj ANTHROPIC_API_KEY, aby AI dobierało sceny).",
    prompt: `Cinematic vertical 9:16 B-roll shot, slow push-in, soft natural light, shallow depth of field, calm premium mood. Visual metaphor for: "${s.text}". Colour grade inspired by the brand palette ${theme.primary} and ${theme.accent}. No text, no logos, no faces looking at camera.`,
  }));
}

export async function suggestBroll(compositionId: string, segments: SpokenSegment[], duration: number) {
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id: compositionId }, include: { project: { include: { theme: true } }, question: true } });
  const doc = comp.document as unknown as { theme: ThemeTokens; meta?: { questionText?: string } };
  const theme = comp.project.theme ? themeFromRow(comp.project.theme) : doc.theme;
  if (!segments.length) throw new Error("Brak transkrypcji — najpierw wygeneruj napisy, żeby AI wiedziało, o czym mówi ekspert.");
  const question = comp.question?.text ?? doc.meta?.questionText ?? "";
  const raw = env.anthropicConfigured ? await suggestWithClaude(question, segments, theme, duration) : suggestHeuristic(segments, theme, duration);
  return { suggestions: sanitize(raw, duration), engine: env.anthropicConfigured ? "claude" : "basic" };
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
    await downloadVideo(url, file);
    const asset = await ingestOverlayVideo(file, dir, comp.projectId, `AI: ${p.prompt.slice(0, 60)}`, { source: "higgsfield", model: videoModel(p.model).id, requestId });
    return { assetId: asset.id, requestId };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}
