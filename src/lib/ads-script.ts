import Papa from "papaparse";

/** One reel of an ad campaign: its parts in order (hook, body, CTA…), each a text the expert says. */
export interface AdScriptReel {
  code: string;
  title: string | null;
  parts: Array<{ role: string; text: string }>;
}

const clean = (v: unknown) => String(v ?? "").replace(/\r/g, "").trim();
const key = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9]/g, "");

/** Header names → roles. Anything else after the id / title columns is a part too, under its own name. */
function roleOf(header: string): string {
  const k = key(header);
  if (/^hook/.test(k)) return "hook";
  if (/^(body|tresc|srodek|glowna)/.test(k)) return k.replace(/^(body|tresc|srodek|glowna)/, "body");
  if (/^(cta|calltoaction|wezwanie)/.test(k)) return "cta";
  return header.trim().toLowerCase() || "part";
}

/**
 * Ads script (CSV, ; or , separated, with a header row):
 *   reel ; tytuł ; hook ; body ; cta      — more body columns allowed (body 2, body 3…), any order
 * - reel: the reel's id (R001, 1, „rata-1”…) — unique in the file
 * - tytuł: optional, the name in the list / the title on the video
 * - every other column is a part said by the expert, in the column order; empty cells are skipped
 * The same body / CTA text in many reels is recorded once — it is reused in each of them.
 */
export function parseAdsScript(text: string): { reels: AdScriptReel[]; errors: string[] } {
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ""), { header: false, skipEmptyLines: "greedy" });
  const rows = res.data.filter((r) => r.some((c) => clean(c)));
  const errors: string[] = [];
  if (rows.length < 2) return { reels: [], errors: ["Plik musi mieć wiersz nagłówka i co najmniej jeden reels."] };
  const head = rows[0].map(clean);
  const idCol = head.findIndex((h) => /^(reel|reels|id|nr|numer|kod|code|film)$/.test(key(h)));
  const titleCol = head.findIndex((h) => /^(tytul|title|nazwa|name)$/.test(key(h)));
  if (idCol < 0) return { reels: [], errors: ["Brak kolumny „reel” (identyfikator reelsa) w nagłówku."] };
  const partCols = head.map((h, i) => ({ h, i })).filter(({ i, h }) => i !== idCol && i !== titleCol && h);
  if (!partCols.length) return { reels: [], errors: ["Brak kolumn z treścią (np. hook; body; cta)."] };
  const seen = new Set<string>();
  const reels: AdScriptReel[] = [];
  rows.slice(1).forEach((r, n) => {
    const code = clean(r[idCol]);
    if (!code) return;
    if (seen.has(code)) {
      errors.push(`Wiersz ${n + 2}: reels „${code}” powtarza się — pominięty.`);
      return;
    }
    seen.add(code);
    const parts = partCols.map(({ h, i }) => ({ role: roleOf(h), text: clean(r[i]) })).filter((p) => p.text.length >= 2);
    if (!parts.length) {
      errors.push(`Wiersz ${n + 2}: reels „${code}” nie ma treści.`);
      return;
    }
    reels.push({ code, title: titleCol >= 0 ? clean(r[titleCol]) || null : null, parts });
  });
  return { reels, errors };
}

export function adsScriptTemplate(): string {
  const rows = [
    ["reel", "tytuł", "hook", "body", "cta"],
    ["R001", "Rata wyższa niż pensja", "Twoja rata jest wyższa niż cała wypłata? Posłuchaj.", "Jeśli nie jesteś w stanie spłacać zobowiązań, upadłość konsumencka może dać Ci nowy start. Sąd ustala plan spłaty dopasowany do Twoich możliwości.", "Zrób bezpłatny test na Instrukcje Prawne kropka pe el."],
    ["R002", "Komornik zajął konto", "Komornik zajął Ci konto? Nie panikuj.", "Jeśli nie jesteś w stanie spłacać zobowiązań, upadłość konsumencka może dać Ci nowy start. Sąd ustala plan spłaty dopasowany do Twoich możliwości.", "Sprawdź, czy się kwalifikujesz — link w opisie."],
  ];
  return "﻿" + Papa.unparse(rows, { delimiter: ";", newline: "\r\n", quotes: true });
}
