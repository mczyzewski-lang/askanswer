import type { EditorDocument, TextOverlay, TextStyle, ThemeTokens } from "./editor/types";

/**
 * How the viewer's question is shown on the video — a theme setting, so it is the same in every
 * video of the project (and changes everywhere when the theme changes).
 */
export type QuestionStyleId = "card" | "plain" | "outline" | "accent" | "pill";
export type QuestionPosition = "top" | "center" | "lower";

export const QUESTION_STYLES: Array<{ id: QuestionStyleId; label: string; hint: string; style: Partial<TextStyle> }> = [
  {
    id: "card",
    label: "Ramka",
    hint: "tekst na kolorowej karcie",
    style: { fontSize: 58, fontWeight: 800, color: "$text", background: "$primary", backgroundOpacity: 0.9, padding: 30, radius: 26, shadow: 24, uppercase: true, outline: 0, accentBar: false },
  },
  {
    id: "plain",
    label: "Sam tekst",
    hint: "bez ramki, z delikatnym cieniem",
    style: { fontSize: 68, fontWeight: 800, color: "$text", background: null, backgroundOpacity: 0, padding: 10, radius: 0, shadow: 26, uppercase: false, outline: 0, accentBar: false },
  },
  {
    id: "outline",
    label: "Obrys",
    hint: "tekst z konturem, czytelny na każdym tle",
    style: { fontSize: 66, fontWeight: 900, color: "$text", background: null, backgroundOpacity: 0, padding: 10, radius: 0, shadow: 0, uppercase: true, outline: 7, accentBar: false },
  },
  {
    id: "accent",
    label: "Z akcentem",
    hint: "bez ramki, kreska w kolorze akcentu",
    style: { fontSize: 64, fontWeight: 800, color: "$text", background: null, backgroundOpacity: 0, padding: 10, radius: 0, shadow: 20, uppercase: false, outline: 0, accentBar: true },
  },
  {
    id: "pill",
    label: "Etykieta",
    hint: "mniejszy tekst na pigułce w kolorze akcentu",
    style: { fontSize: 46, fontWeight: 800, color: "$background", background: "$accent", backgroundOpacity: 1, padding: 24, radius: 60, shadow: 16, uppercase: true, outline: 0, accentBar: false },
  },
];

export const QUESTION_POSITIONS: Array<{ id: QuestionPosition; label: string; y: number }> = [
  { id: "top", label: "Góra", y: 0.085 },
  { id: "center", label: "Środek", y: 0.4 },
  { id: "lower", label: "Niżej", y: 0.56 },
];

export function questionStyleOf(theme: Pick<ThemeTokens, "questionStyle" | "questionPosition">) {
  const style = QUESTION_STYLES.find((s) => s.id === theme.questionStyle) ?? QUESTION_STYLES[0];
  const pos = QUESTION_POSITIONS.find((p) => p.id === theme.questionPosition) ?? QUESTION_POSITIONS[0];
  return { style, pos, key: `${style.id}:${pos.id}` };
}

/** The question layer in the theme's question style and position (text, timing and animation kept). */
export function styledQuestion(o: TextOverlay, theme: Pick<ThemeTokens, "questionStyle" | "questionPosition">): TextOverlay {
  const { style, pos, key } = questionStyleOf(theme);
  const w = style.id === "pill" ? 0.8 : 0.86;
  return { ...o, x: (1 - w) / 2, y: pos.y, w, style: { ...o.style, ...style.style, align: "center" }, themeStyle: key };
}

/**
 * The project theme is the source of truth: colours/fonts and the question style propagate to
 * every video, in the Studio and in the export. Questions laid out before keep "card:top".
 */
export function syncTheme(doc: EditorDocument, theme: ThemeTokens): void {
  doc.theme = theme;
  const key = questionStyleOf(theme).key;
  doc.overlays = doc.overlays.map((o) => (o.kind === "text" && o.role === "question" && (o.themeStyle ?? "card:top") !== key ? styledQuestion(o, theme) : o));
}
