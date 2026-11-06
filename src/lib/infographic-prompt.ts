/**
 * The prompt of an infographic drawn whole by OpenAI (text included) — a template per theme with
 * {{placeholders}} filled for each graphic. The base template lives here; a theme may keep its own
 * edited copy (Theme.infographicPrompt), and "Przywróć bazowy" brings this one back.
 */
import { colorName } from "./broll-style";
import type { ThemeTokens } from "./editor/types";

export const TEXT_SAFE_ZONE =
  "TEXT PLACEMENT (strict): every letter, word, number, label and arrow label must be inside the band between 20% and 68% of the image height. The bottom 30% of the image must stay completely free of lettering — not even small labels or numbers — because the video captions are placed there; keep it to artwork only.";

export const INFOGRAPHIC_PROMPT_BASE = [
  "Vertical 9:16 infographic for a short expert video on TikTok/Reels.",
  "Language: Polish. Render every text exactly as written below, with correct Polish letters (ą ć ę ł ń ó ś ź ż); add no other words.",
  "Headline: «{{headline}}»",
  "Rows:",
  "{{rows}}",
  "{{note}}",
  "Layout: keep the top 22% and the bottom 32% of the image calm, without text (the video title and captions are placed there). Put the infographic card with all text in the middle band, large and legible on a phone.",
  TEXT_SAFE_ZONE,
  "Brand colours: background {{background}}, card {{primary}}, highlights {{accent}} and {{highlight}}, text {{text}}.",
  "Clean, modern, premium design with simple icons; high contrast; no logos, no watermarks, no people's faces.",
  "{{style}}",
].join("\n");

/** what each placeholder becomes (shown in the theme editor) */
export const INFOGRAPHIC_TOKENS: Array<[string, string]> = [
  ["{{headline}}", "nagłówek infografiki"],
  ["{{rows}}", "wiersze: liczba — opis"],
  ["{{note}}", "przypis (jeśli jest)"],
  ["{{background}}", "kolor tła motywu"],
  ["{{primary}}", "kolor główny (karta)"],
  ["{{accent}}", "akcent"],
  ["{{highlight}}", "podświetlenie"],
  ["{{text}}", "kolor tekstu"],
  ["{{style}}", "styl scen AI (motyw / kategoria)"],
];

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
/** a template equal to the base is not a change */
export const isBasePrompt = (t: string | null | undefined) => !t || norm(t) === norm(INFOGRAPHIC_PROMPT_BASE);

export interface InfographicContent {
  headline: string;
  items: Array<{ value: string; label: string }>;
  note?: string | null;
}

/** The prompt for one infographic: the theme's template (or the base) with its values filled in. */
export function infographicPrompt(info: InfographicContent, theme: ThemeTokens, style: string | null, template?: string | null): string {
  const c = (hex: string) => `${colorName(hex)} (${hex})`;
  const values: Record<string, string> = {
    headline: info.headline,
    rows: info.items.map((r, i) => `${i + 1}. big value «${r.value}» — label «${r.label}»`).join("\n"),
    note: info.note ? `Small footnote: «${info.note}»` : "",
    background: c(theme.background),
    primary: c(theme.primary),
    accent: c(theme.accent),
    highlight: c(theme.highlight),
    text: c(theme.text),
    style: style ? `Visual style of the illustration elements (as a still image): ${style}` : "",
  };
  return (isBasePrompt(template) ? INFOGRAPHIC_PROMPT_BASE : norm(template!))
    .replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in values ? values[k] : m))
    .split("\n")
    .filter((l) => l.trim())
    .join("\n");
}
