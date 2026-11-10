/**
 * Content never uses the long dash: "—" and "–" become "-" ("Rozwód — plan" → "Rozwód - plan",
 * "3–5" → "3-5"). Used where texts are generated, saved and drawn.
 */
export function plainDashes(s: string): string {
  if (!/[—–]/.test(s)) return s;
  return s.replace(/[  ]*[—–][  ]*/g, (m) => (m.length === 1 ? "-" : " - "));
}

/** every string inside (objects, arrays) with plain dashes */
export function plainDashesDeep<T>(v: T): T {
  if (typeof v === "string") return plainDashes(v) as T;
  if (Array.isArray(v)) return v.map((x) => plainDashesDeep(x)) as T;
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, plainDashesDeep(x)])) as T;
  return v;
}

/** the rule for every prompt that writes content */
export const NO_LONG_DASH_RULE = "Nigdy nie używaj długiej pauzy „—” ani półpauzy „–”: zawsze zwykły łącznik „-”.";
