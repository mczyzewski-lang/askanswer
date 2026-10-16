import Papa from "papaparse";
import { kindFromCsv, KIND_LABELS, type QuestionKind } from "./question-kinds";

/**
 * CSV import for questions (Answers) and scripts (Prompter).
 *
 * Prompter file (semicolon or comma, header row required, column order free):
 *   Kategoria;Podkategoria;Hook;Treść
 *   Growth;sprzedaż;3 błędy, które kosztują Cię klientów;"Pierwszy błąd…
 *   Drugi błąd…"
 * Optional column "Ekspert" (name as in Eksperci) assigns the row; without it the category's default
 * expert or the project's only expert is used.
 * Multi-line Treść must be in quotes (Excel does it for Alt+Enter line breaks).
 * UTF-8 (with or without BOM) and Windows-1250 (Polish Excel "CSV") are both read correctly.
 */
export interface ImportRow {
  kind?: QuestionKind;
  text: string;
  script?: string | null;
  categoryName?: string;
  subcategoryName?: string;
  instructions?: string | null;
  expertName?: string;
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
        expertName: get("ekspert", "expert") || undefined,
        maxDurationSec: Number.isFinite(max) && max > 0 ? Math.round(max) : null,
      };
    })
    .filter((r) => r.text.length >= 3);
}

/** Example file offered for download (UTF-8 with BOM so Excel shows Polish letters). */
export function csvTemplate(prompter: boolean): string {
  const rows = prompter
    ? [
        ["Kategoria", "Podkategoria", "Hook", "Treść", "Ekspert"],
        ["Growth", "sprzedaż", "3 błędy, które kosztują Cię klientów", "Pierwszy błąd to brak odpowiedzi w ciągu 24 godzin.\nDrugi błąd to oferta bez konkretnej ceny.\nTrzeci błąd to brak follow-upu po spotkaniu.", ""],
        ["Growth", "", "Dlaczego Twoje reklamy nie działają?", "Najczęściej problemem nie jest budżet, tylko komunikat.", ""],
      ]
    : [
        ["Kategoria", "Podkategoria", "Pytanie", "Instrukcje", "Czas", "Ekspert"],
        ["Rozwody", "dzieci", "Kto decyduje o opiece nad dzieckiem?", "Odpowiedz w 3–4 zdaniach", "60", ""],
        ["Rozwody", "", "Ile trwa sprawa rozwodowa?", "", "", ""],
      ];
  return "﻿" + Papa.unparse(rows, { delimiter: ";", newline: "\r\n", quotes: true });
}

/**
 * Mixed (hybrid) file — one row per item, with or without a header row:
 *   pytania|prompter|pytaniazprompterem ; kategoria ; podkategoria ; tytuł wideo ; treść [; ekspert]
 * The video title is shown at the top of the video (and read by the narrator for questions);
 * "treść" is the prompter text (prompter kinds) or the expert's notes (pytania).
 * Returns null when the file is not in this format.
 */
export function parseHybridCsv(text: string): ImportRow[] | null {
  const res = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), { header: false, skipEmptyLines: "greedy" });
  const rows = res.data.filter((r) => r.some((c) => String(c ?? "").trim()));
  if (!rows.length) return null;
  const clean = (v: unknown) => String(v ?? "").replace(/\r/g, "").trim();
  let col = { kind: 0, cat: 1, sub: 2, title: 3, body: 4, expert: 5 };
  let body = rows;
  if (!kindFromCsv(clean(rows[0][0]))) {
    // header row: find the columns by name
    const h = rows[0].map((c) => key(clean(c)));
    const find = (...names: string[]) => h.findIndex((x) => names.map(key).includes(x));
    const kindCol = find("typ", "rodzaj", "kind", "type", "format");
    if (kindCol < 0) return null;
    col = {
      kind: kindCol,
      cat: find("kategoria", "category"),
      sub: find("podkategoria", "temat", "subcategory"),
      title: find("wideotitle", "wideo-title", "tytułwideo", "tytul wideo", "tytuł", "tytul", "title", "hook", "pytanie"),
      body: find("treść", "tresc", "script", "skrypt", "content", "tekst"),
      expert: find("ekspert", "expert"),
    };
    body = rows.slice(1);
  }
  const at = (r: string[], i: number) => (i >= 0 ? clean(r[i]) : "");
  return body
    .map((r): ImportRow | null => {
      const kind = kindFromCsv(at(r, col.kind));
      if (!kind) return null;
      const title = at(r, col.title);
      const content = at(r, col.body);
      const base = { kind, categoryName: at(r, col.cat) || undefined, subcategoryName: at(r, col.sub) || undefined, expertName: at(r, col.expert) || undefined, maxDurationSec: null };
      if (kind === "QUESTION") return { ...base, text: title || content, script: null, instructions: title && content ? content : null };
      return { ...base, text: title || content.split(/\n/)[0], script: content || null, instructions: null };
    })
    .filter((r): r is ImportRow => !!r && r.text.length >= 3);
}

/** Example of the mixed file (UTF-8 with BOM). */
export function hybridCsvTemplate(): string {
  const rows = [
    ["Typ", "Kategoria", "Podkategoria", "Tytuł wideo", "Treść"],
    [KIND_LABELS.QUESTION.csv, "Rozwody", "dzieci", "Kto decyduje o opiece nad dzieckiem?", "Wskazówka dla eksperta: odpowiedz w 3–4 zdaniach"],
    [KIND_LABELS.PROMPTER.csv, "Growth", "sprzedaż", "3 błędy, które kosztują Cię klientów", "Pierwszy błąd to brak odpowiedzi w ciągu 24 godzin.\nDrugi błąd to oferta bez konkretnej ceny."],
    [KIND_LABELS.QUESTION_PROMPTER.csv, "Growth", "", "Jak podnieść ceny i nie stracić klientów?", "Zacznij od klientów, którzy najbardziej cenią Twoją pracę.\nPodnieś cenę dla nowych zleceń, nie dla trwających."],
  ];
  return "\uFEFF" + Papa.unparse(rows, { delimiter: ";", newline: "\r\n", quotes: true });
}
