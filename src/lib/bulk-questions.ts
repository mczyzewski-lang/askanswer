/**
 * "Wklej wiele" line parser.
 *   "1. [dzieci] Kto decyduje o opiece?"   → subcategory "dzieci" (inside the chosen category)
 *   "[Rozwody/dzieci] Kto decyduje…"       → category "Rozwody", subcategory "dzieci"
 *   "Kto decyduje o opiece?"               → no subcategory
 */
export interface BulkLine {
  text: string;
  category?: string;
  subcategory?: string;
}

export function parseBulkLine(raw: string): BulkLine | null {
  let line = raw.replace(/^\s*(\d+[.)]|[-•*])\s*/, "").trim();
  let category: string | undefined;
  let subcategory: string | undefined;
  const m = /^\[([^\]]{1,120})\]\s*/.exec(line);
  if (m) {
    line = line.slice(m[0].length).trim();
    const parts = m[1]
      .split(/\s*[/>›]\s*/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      category = parts[0].slice(0, 80);
      subcategory = parts[1].slice(0, 80);
    } else if (parts.length === 1) subcategory = parts[0].slice(0, 80);
  }
  if (line.length < 3) return null;
  return { text: line, category, subcategory };
}

export function parseBulk(text: string): BulkLine[] {
  return text
    .split(/\n+/)
    .map(parseBulkLine)
    .filter((l): l is BulkLine => !!l);
}

export interface BulkScript extends BulkLine {
  script: string;
}

/**
 * "Wklej wiele" for Prompter projects: one script per block, blocks separated by an empty line.
 * The first line is the hook (with the same optional [temat] / [Kategoria/temat] prefix), the rest is
 * the script body ("Treść"). Optional "Hook:" / "Treść:" labels are stripped.
 */
export function parseBulkScripts(text: string): BulkScript[] {
  return text
    .replace(/\r/g, "")
    .split(/\n\s*\n+/)
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return null;
      const head = parseBulkLine(lines[0].replace(/^hook\s*[:–-]\s*/i, ""));
      if (!head) return null;
      const script = lines
        .slice(1)
        .join("\n")
        .replace(/^(treść|tresc|content|script)\s*[:–-]\s*/i, "")
        .trim();
      return { ...head, script };
    })
    .filter((b): b is BulkScript => !!b);
}
