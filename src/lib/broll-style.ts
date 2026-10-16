import type { ThemeTokens } from "./editor/types";

/**
 * Visual style prompts for AI scenes. A style describes HOW scenes look (medium, lines, texture,
 * motion and audio rules); the AI writes WHAT happens from the expert's words. Colours come from the
 * project theme through placeholders, so one style works with every brand palette:
 *   {{paper}}  very light tint of the theme background (drawing surface)
 *   {{ink}}    deep shade of the primary colour (lines, hatching)
 *   {{accent}} muted accent colour (small highlights)
 *   {{primary}} {{secondary}} {{accent_raw}} {{highlight}} {{background}} — plain colour names
 */
export const INK_EDITORIAL_STYLE =
  "Hand-drawn editorial ink animation on warm textured paper tinted {{paper}}, thin imperfect pen lines and charcoal hatching in {{ink}}, subtle paper grain, tiny {{accent}} accents only during conflict or key moments. " +
  "Keep one consistent look and the same recurring objects in every shot. Motion from frame one. Characters only emote and gesture, they do NOT talk; faceless or simplified figures, no readable text, letters or logos. " +
  "Diegetic audio only, no speech, no music.";

export const STYLE_PRESETS: Array<{ key: string; label: string; style: string }> = [
  { key: "ink", label: "Rysunek tuszem (editorial)", style: INK_EDITORIAL_STYLE },
  {
    key: "cinematic",
    label: "Filmowy realizm",
    style:
      "Cinematic photorealistic B-roll, shallow depth of field, soft natural light, gentle camera movement, colour grade with {{ink}} shadows and {{accent}} highlights. No readable text, logos or people speaking to camera. Diegetic audio only, no speech, no music.",
  },
  {
    key: "paper",
    label: "Papierowa wycinanka 3D",
    style:
      "Stop-motion paper cut-out diorama, layered card stock in {{primary}} and {{secondary}} tones on a {{paper}} background, soft studio light, tiny {{accent}} details, slight handmade jitter. Motion from frame one. No readable text or logos. Diegetic audio only, no speech, no music.",
  },
];

function hsl(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}

const HUES: Array<[number, string]> = [
  [12, "red"],
  [35, "orange"],
  [50, "amber"],
  [65, "yellow"],
  [85, "olive green"],
  [150, "green"],
  [180, "teal"],
  [200, "cyan blue"],
  [235, "blue"],
  [255, "indigo"],
  [285, "violet"],
  [320, "magenta"],
  [345, "pink"],
  [361, "red"],
];

/** Plain-language colour name ("dark blue", "pale amber"); video models read words better than hex. */
export function colorName(hex: string): string {
  const v = hsl(hex);
  if (!v) return hex;
  const [h, s, l] = v;
  if (s < 0.12 || l < 0.06 || l > 0.97) {
    if (l < 0.15) return "near-black";
    if (l < 0.4) return "charcoal grey";
    if (l < 0.75) return "grey";
    return l > 0.93 ? "off-white" : "light grey";
  }
  let name = HUES.find(([max]) => h < max)?.[1] ?? "red";
  if (name === "blue" && l < 0.3) name = "navy blue";
  if (name === "orange" && l < 0.35) name = "brown";
  const tone = l < 0.25 ? "dark " : l < 0.4 ? "deep " : l > 0.8 ? "pale " : l > 0.65 ? "light " : s < 0.35 ? "muted " : "";
  return `${tone}${name}`;
}

/** Replace colour placeholders with names from the theme palette. */
export function fillStyle(style: string, theme: ThemeTokens): string {
  const bare = (c: string) => colorName(c).replace(/^(dark|deep|pale|light|muted) /, "");
  const values: Record<string, string> = {
    paper: `a very light ${bare(theme.background)} (almost white)`,
    ink: `deep ${bare(theme.primary)}`,
    accent: `muted ${bare(theme.accent)}`,
    primary: colorName(theme.primary),
    secondary: colorName(theme.secondary),
    accent_raw: colorName(theme.accent),
    highlight: colorName(theme.highlight),
    background: colorName(theme.background),
  };
  return style.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, k: string) => values[k] ?? all);
}
