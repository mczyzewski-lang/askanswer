/** Wording that depends on the project format (Answers = questions, Prompter = scripts with a hook). */
export type ProjectFormat = "ANSWERS" | "PROMPTER";

export function terms(format: ProjectFormat | string | null | undefined) {
  const prompter = format === "PROMPTER";
  return prompter
    ? {
        prompter,
        one: "skrypt",
        few: "skrypty",
        many: "skryptów",
        title: "Hook",
        tab: "Skrypty i nagrania",
        add: "Dodaj skrypt",
        newTitle: "Nowy skrypt",
        editTitle: "Edytuj skrypt",
      }
    : {
        prompter,
        one: "pytanie",
        few: "pytania",
        many: "pytań",
        title: "Treść pytania",
        tab: "Pytania i nagrania",
        add: "Dodaj pytanie",
        newTitle: "Nowe pytanie",
        editTitle: "Edytuj pytanie",
      };
}

export const FORMAT_LABELS: Record<ProjectFormat, { name: string; description: string }> = {
  ANSWERS: { name: "Answers", description: "Ekspert odpowiada na pytania czytane przez lektora" },
  PROMPTER: { name: "Prompter", description: "Ekspert czyta Hook + Treść z promptera, który przewija się za jego głosem" },
};
