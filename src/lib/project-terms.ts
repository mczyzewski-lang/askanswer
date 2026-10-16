/** Wording that depends on the project format (Answers = questions, Prompter = scripts with a hook). */
export type ProjectFormat = "ANSWERS" | "PROMPTER" | "HYBRID";

export function terms(format: ProjectFormat | string | null | undefined) {
  const prompter = format === "PROMPTER";
  if (format === "HYBRID")
    return {
      prompter: false,
      hybrid: true,
      one: "pozycja",
      few: "pozycje",
      many: "pozycji",
      title: "Tytuł wideo",
      tab: "Pytania, skrypty i nagrania",
      add: "Dodaj pozycję",
      newTitle: "Nowa pozycja",
      editTitle: "Edytuj pozycję",
    };
  return prompter
    ? {
        prompter,
        hybrid: false,
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
        hybrid: false,
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
  HYBRID: { name: "Hybryda", description: "W jednym projekcie: pytania z lektorem, skrypty z promptera oraz pytania z lektorem + odpowiedź z promptera" },
};
