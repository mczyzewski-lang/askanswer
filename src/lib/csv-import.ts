import Papa from "papaparse";

/**
 * CSV import for questions (Answers) and scripts (Prompter).
 *
 * Prompter file (semicolon or comma, header row required, column order free):
 *   Kategoria;Podkategoria;Hook;Treść
 *   Growth;sprzedaż;3 błędy, które kosztują Cię klientów;"Pierwszy błąd…
 *   Drugi błąd…"
 * Multi-line Treść must be in quotes (Excel does it for Alt+Enter line breaks).
 * UTF-8 (with or without BOM) and Windows-1250 (Polish Excel "CSV") are both read correctly.
 */
export interface ImportRow {
  text: string;
  script?: string | null;
  categoryName?: string;
  subcategoryName?: string;
  instructions?: string | null;
  maxDurationSec?: number | null;
}

export function decodeCsv(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1250").decode(bytes);
  }
}

const FOLD: Record<string, string> = { ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z" };
const key = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => FOLD[c])
    .replace(/[^a-z0-9]/g, "");

export function parseImportCsv(text: string, prompter: boolean): ImportRow[] {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: key });
  return res.data
    .map((r) => {
      const get = (...names: string[]) => {
        for (const n of names) {
          const v = r[key(n)];
          if (v != null && String(v).trim()) return String(v).replace(/\r/g, "").trim();
        }
        return "";
      };
      const max = Number(get("czas", "maks", "max", "maxdurationsec", "duration"));
      return {
        text: prompter ? get("hook", "tytuł", "title", "pytanie") : get("pytanie", "question", "text", "treść"),
        script: prompter ? get("treść", "tresc", "script", "skrypt", "content", "tekst") || null : undefined,
        categoryName: get("kategoria", "category") || undefined,
        subcategoryName: get("podkategoria", "temat", "subcategory") || undefined,
        instructions: get("instrukcje", "instructions", "wskazówki") || null,
        maxDurationSec: Number.isFinite(max) && max > 0 ? Math.round(max) : null,
      };
    })
    .filter((r) => r.text.length >= 3);
}

/** Example file offered for download (UTF-8 with BOM so Excel shows Polish letters). */
export function csvTemplate(prompter: boolean): string {
  const rows = prompter
    ? [
        ["Kategoria", "Podkategoria", "Hook", "Treść"],
        ["Growth", "sprzedaż", "3 błędy, które kosztują Cię klientów", "Pierwszy błąd to brak odpowiedzi w ciągu 24 godzin.\nDrugi błąd to oferta bez konkretnej ceny.\nTrzeci błąd to brak follow-upu po spotkaniu."],
        ["Growth", "", "Dlaczego Twoje reklamy nie działają?", "Najczęściej problemem nie jest budżet, tylko komunikat."],
      ]
    : [
        ["Kategoria", "Podkategoria", "Pytanie", "Instrukcje", "Czas"],
        ["Rozwody", "dzieci", "Kto decyduje o opiece nad dzieckiem?", "Odpowiedz w 3–4 zdaniach", "60"],
        ["Rozwody", "", "Ile trwa sprawa rozwodowa?", "", ""],
      ];
  return "﻿" + Papa.unparse(rows, { delimiter: ";", newline: "\r\n", quotes: true });
}
