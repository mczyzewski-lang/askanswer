/**
 * Google Ads Performance Max — component rules used by the "Google Adwords" module. Kept as data (not
 * magic numbers in the code): the validators, completeness checks and the "Wytyczne PMax" screen all
 * read from here. Update `verifiedAt` and the sources when the rules are checked again.
 */

export const PMAX_SPEC = {
  verifiedAt: "2026-11-09",
  /** how it was verified — honest about what could and could not be read */
  verification:
    "Sprawdzone 2026-11-09 na podstawie wyników wyszukiwania stron pomocy Google Ads (same strony support.google.com nie były dostępne z serwera, na którym budowano moduł). Wartości oznaczone „niepotwierdzone” warto sprawdzić ręcznie w źródle.",
  images: {
    formats: [
      { key: "landscape", ratio: "1.91:1", width: 1200, height: 628, minWidth: 600, minHeight: 314, recommendedCount: 4 },
      { key: "square", ratio: "1:1", width: 1200, height: 1200, minWidth: 300, minHeight: 300, recommendedCount: 4 },
      { key: "portrait", ratio: "4:5", width: 960, height: 1200, minWidth: 480, minHeight: 600, recommendedCount: 4 },
    ],
    fileTypes: ["PNG", "JPG"],
    /** 5120 KB */
    maxFileBytes: 5120 * 1024,
    /** keep important content in the middle 80% of the frame (10% margin on each side) */
    safeMargin: 0.1,
    /** in total per asset group (some summaries say per ratio — niepotwierdzone) */
    maxPerGroup: 20,
    requiredPerGroup: { landscape: 1, square: 1, portrait: 0 },
  },
  logos: [
    { key: "square", ratio: "1:1", width: 1200, height: 1200, minWidth: 128, minHeight: 128, required: true },
    { key: "landscape", ratio: "4:1", width: 1200, height: 300, minWidth: 512, minHeight: 128, required: false },
  ],
  texts: {
    headline: { label: "Krótki nagłówek", maxChars: 30, maxCount: 15, minCount: 3, recommendedCount: 11, shortOneMaxChars: 15 },
    long_headline: { label: "Długi nagłówek", maxChars: 90, maxCount: 5, minCount: 1, recommendedCount: 2 },
    /** the older "one description ≤60 characters" rule appears dropped (all 5 up to 90) — niepotwierdzone */
    description: { label: "Opis", maxChars: 90, maxCount: 5, minCount: 2, recommendedCount: 4 },
    business_name: { label: "Nazwa firmy", maxChars: 25, maxCount: 1, minCount: 1, recommendedCount: 1 },
  },
  videos: {
    formats: [
      { key: "landscape", ratio: "16:9", width: 1920, height: 1080 },
      { key: "square", ratio: "1:1", width: 1080, height: 1080 },
      { key: "portrait", ratio: "9:16", width: 1080, height: 1920 },
    ],
    minSeconds: 10,
    practicalMaxSeconds: 60,
    /** current spec page; older pages said 5 */
    maxPerGroup: 15,
    note: "Filmy do PMax dodaje się linkiem z YouTube (nie jako plik). Zalecany co najmniej 1 film w każdej orientacji, w tym pionowy 10–60 s (Shorts). Bez własnego filmu Google może wygenerować film automatycznie z grafik i tekstów.",
  },
  /** what differs from the module brief, after checking */
  corrections: [
    "Minimalne rozmiary obrazów: 600×314 (poziomy), 300×300 (kwadrat), 480×600 (pionowy); logo: 128×128 (kwadrat, jedna tabela podaje 144×144 — niepotwierdzone), 512×128 (poziome).",
    "Pionowe 4:5 są opcjonalne — wymagane są poziome i kwadratowe obrazy oraz kwadratowe logo. Google zaleca ≥4 w każdej proporcji (brief: ≥2 pionowe).",
    "Reguła „jeden opis ≤60 znaków” wygląda na wycofaną (wszystkie opisy do 90 znaków) — niepotwierdzone.",
    "Wideo: hosting na YouTube, maks. 15 na grupę komponentów (starsze źródła: 5), zalecany pionowy film 10–60 s.",
  ],
  sources: [
    { url: "https://support.google.com/google-ads/answer/17091269?hl=pl", title: "Wymagania dotyczące komponentów kampanii Performance Max" },
    { url: "https://support.google.com/google-ads/answer/14530211?hl=pl", title: "Specyfikacja komponentów graficznych" },
    { url: "https://support.google.com/google-ads/answer/14528373?hl=pl", title: "Specyfikacja komponentów tekstowych" },
    { url: "https://support.google.com/google-ads/answer/15995750?hl=pl", title: "Komponenty wideo w Performance Max" },
    { url: "https://support.google.com/google-ads/answer/14934472?hl=en", title: "Performance Max asset best practices" },
    { url: "https://support.google.com/google-ads/answer/16030588?hl=en", title: "Asset requirements and recommendations" },
    { url: "https://support.google.com/adspolicy/answer/143465?hl=pl", title: "Reklamy spersonalizowane — kategorie wrażliwe (m.in. trudności w związkach)" },
  ],
} as const;

export type ImageFormatKey = (typeof PMAX_SPEC.images.formats)[number]["key"];
export type TextKind = "headline" | "long_headline" | "description";

/** "1.91:1" / "1200x628" / "landscape" / "16:9" → the format key */
export function formatKeyOf(aspect: string | null | undefined, width?: number | null, height?: number | null): ImageFormatKey | null {
  const a = (aspect ?? "").toLowerCase().replace(/\s/g, "");
  if (/^(1[.,]91:1|landscape|poziom|16:9)/.test(a)) return "landscape";
  if (/^(1:1|square|kwadrat)/.test(a)) return "square";
  if (/^(4:5|portrait|pion|9:16)/.test(a)) return "portrait";
  if (width && height) {
    const r = width / height;
    if (r > 1.4) return "landscape";
    if (r < 0.9) return "portrait";
    return "square";
  }
  return null;
}

export const imageFormat = (k: ImageFormatKey) => PMAX_SPEC.images.formats.find((f) => f.key === k)!;
export const FORMAT_LABEL: Record<ImageFormatKey, string> = { landscape: "Poziomy 1,91:1", square: "Kwadrat 1:1", portrait: "Pionowy 4:5" };
