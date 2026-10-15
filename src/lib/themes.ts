import type { ThemeTokens } from "./editor/types";

/**
 * Starter theme presets. These are generic style starting points — not official
 * brand colours of any company. Administrators set exact brand colours and logos
 * in "Motywy" (Theme Settings).
 */
export const THEME_PRESETS: Array<ThemeTokens & { key: string; description: string }> = [
  {
    key: "pravna",
    name: "Pravna",
    description: "Elegancki styl premium dla kancelarii",
    primary: "#14213D",
    accent: "#C9A227",
    secondary: "#E5E1D8",
    text: "#FFFFFF",
    highlight: "#E9C46A",
    background: "#0B1222",
    questionFont: "Manrope",
    subtitleFont: "Inter",
    labelFont: "Inter",
  },
  {
    key: "nowy-etap",
    name: "Nowy Etap",
    description: "Spokojny, czysty, budzący zaufanie",
    primary: "#1F4E5F",
    accent: "#5FB49C",
    secondary: "#DCEFE8",
    text: "#FFFFFF",
    highlight: "#7BDCB5",
    background: "#10262E",
    questionFont: "DM Sans",
    subtitleFont: "DM Sans",
    labelFont: "DM Sans",
  },
  {
    key: "modern-black",
    name: "Modern Black",
    description: "Czarno-biała typografia z wyrazistym akcentem",
    primary: "#0A0A0A",
    accent: "#FF4D2E",
    secondary: "#F5F5F5",
    text: "#FFFFFF",
    highlight: "#FF4D2E",
    background: "#000000",
    questionFont: "Montserrat",
    subtitleFont: "Inter",
    labelFont: "Inter",
  },
  {
    key: "minimal-white",
    name: "Minimal White",
    description: "Minimalistyczna biel i subtelne wyróżnienia",
    primary: "#FFFFFF",
    accent: "#2563EB",
    secondary: "#F3F4F6",
    text: "#111827",
    highlight: "#93C5FD",
    background: "#F8FAFC",
    questionFont: "Inter",
    subtitleFont: "Inter",
    labelFont: "Inter",
  },
  {
    key: "social-bold",
    name: "Social Bold",
    description: "Wysoki kontrast, duże animowane napisy",
    primary: "#7C3AED",
    accent: "#FACC15",
    secondary: "#111827",
    text: "#FFFFFF",
    highlight: "#FACC15",
    background: "#1E1B4B",
    questionFont: "Poppins",
    subtitleFont: "Montserrat",
    labelFont: "Poppins",
  },
];

export const FONT_FAMILIES = ["Inter", "Manrope", "Montserrat", "Poppins", "DM Sans"] as const;
export const FONT_WEIGHTS = [400, 500, 600, 700, 800] as const;

export function themeFromRow(row: {
  name: string;
  primaryColor: string;
  accentColor: string;
  secondaryColor: string;
  textColor: string;
  highlightColor: string;
  backgroundColor: string;
  questionFont: string;
  subtitleFont: string;
  labelFont: string;
  logoAssetId: string | null;
}): ThemeTokens {
  return {
    name: row.name,
    primary: row.primaryColor,
    accent: row.accentColor,
    secondary: row.secondaryColor,
    text: row.textColor,
    highlight: row.highlightColor,
    background: row.backgroundColor,
    questionFont: row.questionFont,
    subtitleFont: row.subtitleFont,
    labelFont: row.labelFont,
    logoAssetId: row.logoAssetId,
  };
}

export const DEFAULT_THEME: ThemeTokens = THEME_PRESETS[0];
