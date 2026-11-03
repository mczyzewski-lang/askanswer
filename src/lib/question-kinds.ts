/**
 * What an item is recorded as. A HYBRID project mixes them; other projects use one kind for all.
 *  - QUESTION: a client's question read by the ElevenLabs narrator, the expert answers freely
 *  - PROMPTER: hook + script on the teleprompter that follows the expert's voice
 *  - QUESTION_PROMPTER: the narrator reads the client's question, the expert reads the answer from the prompter
 *  - HOOK_PROMPTER: no narrator; the expert reads the hook (a question, `spokenText` or else the title)
 *    and then the script from the prompter; in the CSV the hook has its own column
 * In every kind `text` is the video title shown at the top of the video (and, for the question
 * kinds, what the narrator reads); `script` is what the expert reads from the prompter.
 */
export type QuestionKind = "QUESTION" | "PROMPTER" | "QUESTION_PROMPTER" | "HOOK_PROMPTER";
export const QUESTION_KINDS: QuestionKind[] = ["QUESTION", "PROMPTER", "QUESTION_PROMPTER", "HOOK_PROMPTER"];

export const KIND_LABELS: Record<QuestionKind, { name: string; short: string; hint: string; csv: string }> = {
  QUESTION: { name: "Pytanie (lektor)", short: "Pytanie", hint: "Lektor ElevenLabs czyta pytanie klienta, ekspert odpowiada swobodnie.", csv: "pytania" },
  PROMPTER: { name: "Prompter", short: "Prompter", hint: "Ekspert czyta Hook + Treść z promptera, który przewija się za jego głosem.", csv: "prompter" },
  QUESTION_PROMPTER: { name: "Pytanie + prompter", short: "Pytanie + prompter", hint: "Lektor czyta pytanie klienta, potem ekspert czyta odpowiedź z promptera.", csv: "pytaniazprompterem" },
  HOOK_PROMPTER: { name: "Hook + prompter", short: "Hook + prompter", hint: "Ekspert sam czyta z promptera hook (pytanie), potem treść. Bez lektora.", csv: "hookzprompterem" },
};

export function effectiveKind(kind: string | null | undefined, format: string | null | undefined): QuestionKind {
  if (kind === "QUESTION" || kind === "PROMPTER" || kind === "QUESTION_PROMPTER" || kind === "HOOK_PROMPTER") return kind;
  return format === "PROMPTER" ? "PROMPTER" : "QUESTION";
}

/** Narrator reads the question before recording. */
export const kindHasNarration = (k: QuestionKind) => k === "QUESTION" || k === "QUESTION_PROMPTER";
/** The expert reads from the teleprompter. */
export const kindHasPrompter = (k: QuestionKind) => k !== "QUESTION";

/** What the expert reads as the hook from the prompter ("" = none: the narrator asks the question). */
export const prompterHook = (k: QuestionKind, q: { text: string; spokenText?: string | null }) =>
  k === "PROMPTER" ? q.text : k === "HOOK_PROMPTER" ? q.spokenText?.trim() || q.text : "";

/** "pytania" / "prompter" / "pytaniazprompterem" / "hookzprompterem" (and close spellings) → kind. */
export function kindFromCsv(v: string): QuestionKind | null {
  const k = v
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z]/g, "");
  if (!k) return null;
  if (/^hook(i|a)?z?prompter(em)?$/.test(k)) return "HOOK_PROMPTER";
  if (/^pytani[ae]?z?prompter(em)?$/.test(k) || k === "pytanieprompter" || k === "questionprompter") return "QUESTION_PROMPTER";
  if (k === "prompter" || k === "skrypt" || k === "skrypty") return "PROMPTER";
  if (k === "pytania" || k === "pytanie" || k === "question" || k === "questions") return "QUESTION";
  return null;
}
