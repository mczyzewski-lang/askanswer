import Papa from "papaparse";

/** One reel of an ad campaign: its parts in order (hook, body, CTA…), each a text the expert says. */
export interface AdScriptReel {
  /** unique per row: P01-h01 (or the reel id in the file without hook numbers) */
  code: string;
  /** the reel these hook versions belong to (P01) — one edit for all its hooks */
  group: string | null;
  /** the hook's number (h01) */
  hook: string | null;
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
 *   reel ; hook-number ; tytuł ; hook ; body ; cta
 *   P01  ; h01         ; nazwa hooka ; tekst hooka ; body reelsa ; cta reelsa
 *   P01  ; h02         ; nazwa drugiego hooka ; … ; body reelsa ; cta reelsa
 * - reel + hook-number: one row per hook version; all hooks of a reel are ONE edit (body + CTA
 *   edited once), each hook is a version of it
 * - tytuł: the title at the top of the video for this hook version
 * - every other column is a part said by the expert, in the column order; empty cells are skipped
 *   (body / CTA can be filled in the first row of the reel only)
 * Without the hook-number column each row is a reel of its own (reels with the same body + CTA are
 * still put together as hook versions).
 */
export function parseAdsScript(text: string): { reels: AdScriptReel[]; errors: string[] } {
  const res = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), { header: false, skipEmptyLines: "greedy" });
  const rows = res.data.filter((r) => r.some((c) => clean(c)));
  const errors: string[] = [];
  if (rows.length < 2) return { reels: [], errors: ["Plik musi mieć wiersz nagłówka i co najmniej jeden reels."] };
  const head = rows[0].map(clean);
  const idCol = head.findIndex((h) => /^(reel|reels|id|nr|numer|kod|code|film)$/.test(key(h)));
  const hookNoCol = head.findIndex((h) => /^(hooknumber|hooknr|hooknumer|nrhooka|numerhooka|hookno|hookid|wersja|wersjahooka|hook#)$/.test(key(h)) || /^hook.?(number|nr|numer|no|id)$/i.test(h.trim()));
  const titleCol = head.findIndex((h) => /^(tytul|title|nazwa|name|nazwahooka)$/.test(key(h)));
  if (idCol < 0) return { reels: [], errors: ["Brak kolumny „reel” (identyfikator reelsa) w nagłówku."] };
  const partCols = head.map((h, i) => ({ h, i })).filter(({ i, h }) => i !== idCol && i !== titleCol && i !== hookNoCol && h);
  if (!partCols.length) return { reels: [], errors: ["Brak kolumn z treścią (np. hook; body; cta)."] };
  const seen = new Set<string>();
  const reels: AdScriptReel[] = [];
  // body / CTA of a reel: from its first row, later rows may leave them empty
  const restOf = new Map<string, Array<{ role: string; text: string }>>();
  rows.slice(1).forEach((r, n) => {
    const reel = clean(r[idCol]);
    if (!reel) return;
    const hookNo = hookNoCol >= 0 ? clean(r[hookNoCol]) : "";
    const code = hookNo ? `${reel}-${hookNo}` : reel;
    if (seen.has(code)) {
      errors.push(`Wiersz ${n + 2}: ${hookNo ? `hook ${hookNo} reelsa „${reel}”` : `reels „${reel}”`} powtarza się — pominięty.`);
      return;
    }
    seen.add(code);
    let parts = partCols.map(({ h, i }) => ({ role: roleOf(h), text: clean(r[i]) })).filter((p) => p.text.length >= 2);
    if (hookNoCol >= 0) {
      const rest = parts.filter((p) => p.role !== "hook");
      const first = restOf.get(reel);
      if (!first) restOf.set(reel, rest);
      else if (!rest.length) parts = [...parts.filter((p) => p.role === "hook"), ...first];
      else if (JSON.stringify(rest) !== JSON.stringify(first)) errors.push(`Wiersz ${n + 2}: body / CTA hooka ${hookNo} różni się od pierwszego wiersza reelsa „${reel}” — użyte zostanie body / CTA z pierwszego wiersza.`);
    }
    if (!parts.length) {
      errors.push(`Wiersz ${n + 2}: „${code}” nie ma treści.`);
      return;
    }
    reels.push({ code, group: hookNoCol >= 0 ? reel : null, hook: hookNo || null, title: titleCol >= 0 ? clean(r[titleCol]) || null : null, parts });
  });
  return { reels, errors };
}

export function adsScriptTemplate(): string {
  const body = "Jeśli nie jesteś w stanie spłacać zobowiązań, upadłość konsumencka może dać Ci nowy start. Sąd ustala plan spłaty dopasowany do Twoich możliwości.";
  const cta = "Zrób bezpłatny test na Instrukcje Prawne kropka pe el.";
  const rows = [
    ["reel", "hook-number", "tytuł", "hook", "body", "cta"],
    ["P01", "h01", "Rata wyższa niż pensja", "Twoja rata jest wyższa niż cała wypłata? Posłuchaj.", body, cta],
    ["P01", "h02", "Komornik zajął konto", "Komornik zajął Ci konto? Nie panikuj.", body, cta],
    ["P01", "h03", "Telefony od windykacji", "Windykacja dzwoni kilka razy dziennie? Zrób to.", body, cta],
    ["P02", "h01", "Dług po firmie", "Zamknąłeś firmę, a długi zostały?", "Upadłość konsumencka obejmuje też długi po zamkniętej działalności, jeśli dziś nie prowadzisz firmy.", "Sprawdź, czy się kwalifikujesz — link w opisie."],
  ];
  return "\uFEFF" + Papa.unparse(rows, { delimiter: ";", newline: "\r\n", quotes: true });
}
