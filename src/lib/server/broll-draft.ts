/**
 * A starting point for a visual at one moment of the video, written from what the expert says there:
 * a text-to-video prompt (ElevenLabs / Veo) or the content of an infographic. The user edits it
 * before anything is generated.
 */
import { NO_LONG_DASH_RULE } from "../dashes";
import { prisma } from "./db";
import { env, openaiConfigured } from "./env";
import { openaiErrorText } from "./reel-review";
import { styleFor } from "./broll";
import { themeFromRow } from "../themes";
import type { ThemeTokens } from "../editor/types";
import { colorName } from "../broll-style";

/** The brand palette in words + hex, for the background of a generated scene. */
export function palette(theme: ThemeTokens) {
  const c = (hex: string) => `${colorName(hex)} (${hex})`;
  return `${c(theme.primary)}, ${c(theme.accent)}, ${c(theme.highlight)} and ${c(theme.background)}`;
}

const paletteSentence = (theme: ThemeTokens) => `Where it looks natural, let the secondary background colours of the scene (walls, props, light, out-of-focus areas) follow the brand palette: ${palette(theme)} — not on skin or the main subject.`;

export const DRAFT_SYSTEM = `BROLL_DRAFT
You prepare one visual for a moment of a short vertical (9:16) expert video (TikTok / Reels). The expert keeps talking; the visual is shown full-screen under the captions while they say the passage. Answer JSON only.
- kind "video": write ONE text-to-video prompt in English (60–120 words) for a 4–8 s clip that makes the expert's thought at this moment visible: a concrete scene (subject, action, setting), camera movement, lighting, mood. Realistic, cinematic, vertical framing. No on-screen text, no captions, no logos, no talking heads, no recognizable people. Keep the lower third calm (captions go there). If brand colours are given, end the prompt with one sentence that lets the secondary, background colours of the scene (walls, props, light, out-of-focus areas) follow that palette where it looks natural — never forced onto skin, faces or the main subject. Answer {"prompt": "...", "title": "2–5 words in Polish"}.
- kind "infographic": turn what is said into a simple infographic in Polish: {"headline": "max 6 words", "items": [{"value": "short number / keyword", "label": "max 8 words"}] (2–4 items, only facts that are said), "note": null or a short footnote}.`;

export interface DraftInput {
  kind: "video" | "infographic";
  passage: string;
  focus: string;
}

function fallback(d: DraftInput, style: string | null, theme: ThemeTokens) {
  const thought = (d.focus || d.passage).slice(0, 300);
  if (d.kind === "video")
    return {
      prompt: `Cinematic vertical 9:16 B-roll scene that visually expresses this idea (from a Polish expert video): "${thought}". Concrete real-world setting, gentle camera movement, soft natural light, shallow depth of field. No text, no logos, no faces in close-up; calm lower third for captions.${style ? ` Visual style: ${style}` : ""} ${paletteSentence(theme)}`,
      title: thought.split(/\s+/).slice(0, 4).join(" "),
    };
  const words = thought.split(/\s+/);
  return { headline: words.slice(0, 6).join(" "), items: [{ value: "1.", label: words.slice(0, 8).join(" ") }], note: null };
}

export async function draftVisual(compositionId: string, d: DraftInput) {
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id: compositionId }, include: { project: { include: { theme: true } }, question: true } });
  const doc = comp.document as unknown as { theme: ThemeTokens; meta?: { questionText?: string } };
  const theme = comp.project.theme ? themeFromRow(comp.project.theme) : doc.theme;
  const style = await styleFor(comp, theme);
  if (!openaiConfigured()) return { ...fallback(d, style, theme), engine: "template" as const };
  const user = [
    `kind: ${d.kind}`,
    `Video topic / question (Polish): ${comp.question?.text ?? doc.meta?.questionText ?? ""}`,
    `What the expert says around this moment (Polish): «${d.passage.slice(0, 2000)}»`,
    d.focus ? `The sentence exactly at this moment: «${d.focus.slice(0, 500)}»` : "",
    style && d.kind === "video" ? `Visual style of the brand (keep to it): ${style}` : "",
    d.kind === "video" ? `Brand colours (for the secondary / background colours of the scene): ${palette(theme)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const res = await fetch(`${env.openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.openaiTextModel, response_format: { type: "json_object" }, messages: [{ role: "system", content: `${DRAFT_SYSTEM}\n${NO_LONG_DASH_RULE}` }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = (await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string; code?: string } };
  if (!res.ok) return { ...fallback(d, style, theme), engine: "template" as const, warning: openaiErrorText(res.status, data) };
  try {
    const out = JSON.parse((data.choices?.[0]?.message?.content ?? "{}").replace(/^```(?:json)?\s*|\s*```$/g, "").replace(/[—–]/g, "-")) as Record<string, unknown>;
    if (d.kind === "video" && typeof out.prompt === "string" && out.prompt.trim().length > 20) {
      const prompt = out.prompt.trim();
      const hasPalette = [theme.primary, theme.accent, theme.background].some((h) => prompt.toLowerCase().includes(h.toLowerCase()) || prompt.toLowerCase().includes(colorName(h).toLowerCase()));
      return { prompt: (hasPalette ? prompt : `${prompt} ${paletteSentence(theme)}`).slice(0, 2400), title: String(out.title ?? "").slice(0, 60), engine: "openai" as const };
    }
    if (d.kind === "infographic" && typeof out.headline === "string" && Array.isArray(out.items))
      return {
        headline: out.headline.slice(0, 80),
        items: (out.items as Array<{ value?: unknown; label?: unknown }>).slice(0, 5).map((r) => ({ value: String(r.value ?? "").slice(0, 24), label: String(r.label ?? "").slice(0, 90) })),
        note: typeof out.note === "string" && out.note.trim() ? out.note.slice(0, 120) : null,
        engine: "openai" as const,
      };
  } catch {
    /* fall through */
  }
  return { ...fallback(d, style, theme), engine: "template" as const };
}
