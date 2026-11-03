/**
 * Comment automations ("Skomentuj PLAN, a wyślę Ci link"): which comment triggers which ready reply.
 * Shared by the server (matching) and the UI (preview).
 */

/** lower case, no Polish diacritics, punctuation as spaces: "Plan!!" ≈ "plan", "PĘTLA" ≈ "petla" */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** the keyword as a whole word (or phrase) of the comment — "plan" matches "PLAN 🙏", not "planuję" */
export function matchesKeyword(text: string, keyword: string): boolean {
  const k = fold(keyword);
  return !!k && ` ${fold(text)} `.includes(` ${k} `);
}

/**
 * Only short comments trigger the automation ("PLAN", "plan poproszę 🙏"). A longer one may tell a
 * story or ask something sensitive — it stays for a person to read.
 */
export function isShortTrigger(text: string): boolean {
  const t = text.trim();
  return t.length <= 120 && fold(t).split(" ").filter(Boolean).length <= 10;
}

/**
 * {imię} → the author's first name when it looks like one ("Anna Nowak" → "Anna"); a handle such as
 * "ania_k" gives nothing. Tidies the spaces / commas left behind.
 */
export function fillReply(template: string, authorName: string | null | undefined): string {
  const token = (authorName ?? "").trim().split(/\s+/)[0] ?? "";
  const first = /^\p{Lu}\p{Ll}{1,29}$/u.test(token) ? token : "";
  return template
    .replace(/\{(imię|imie|name)\}/gi, first)
    .replace(/[ \t]+([,.!?])/g, "$1")
    .replace(/^[\s,]+/, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .replace(/^\p{Ll}/u, (ch) => ch.toUpperCase());
}
