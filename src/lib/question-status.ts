/** Workflow of a question / recording, in the order a film goes through it. */
export const QUESTION_STATUSES = [
  ["TO_RECORD", "Do nagrania"],
  ["IN_PROGRESS", "W trakcie"],
  ["RECORDED", "Nagrane"],
  ["NEEDS_FIX", "Do poprawy"],
  ["TO_ACCEPT", "Do akceptacji"],
  ["APPROVED", "Zatwierdzone"],
] as const;

export type QuestionStatus = (typeof QUESTION_STATUSES)[number][0];
