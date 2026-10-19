import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { themeFromRow, DEFAULT_THEME } from "@/lib/themes";
import { fillStyle } from "@/lib/broll-style";
import { backgroundPrompt, callerAvatarPrompt, illustrationPrompt, openaiInfographicPrompt } from "@/lib/server/broll";

/**
 * The prompts sent to the image AI for this project, filled with the project's theme colours and
 * styles; the parts that come from each video are shown as [placeholders].
 */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const project = await prisma.project.findUniqueOrThrow({ where: { id }, include: { theme: true, categories: { orderBy: { order: "asc" }, select: { name: true, brollStyle: true } } } });
  const theme = project.theme ? themeFromRow(project.theme) : DEFAULT_THEME;
  const themeStyle = project.theme?.brollStyle?.trim() ? fillStyle(project.theme.brollStyle.trim(), theme) : null;
  const items = [
    {
      key: "illustration",
      title: "Ilustracja myśli eksperta",
      when: "Automatyczne ilustracje po nagraniu i ilustracje dodawane kliknięciem na osi czasu (3 warianty).",
      prompt: illustrationPrompt(
        {
          imagePrompt: "[pomysł na obraz — AI dobiera go do fragmentu wypowiedzi]",
          passage: "[fragment wypowiedzi eksperta z transkrypcji]",
          question: "[pytanie widza]",
          focus: "[kluczowe zdanie tego momentu]",
          others: ["[myśli pozostałych ilustracji w tym filmie]"],
        },
        theme,
        !!themeStyle,
      ),
    },
    {
      key: "infographic",
      title: "Infografika z liczbami",
      when: "Gdy ekspert podaje konkretne liczby i infografika jest rysowana przez OpenAI.",
      prompt: openaiInfographicPrompt({ headline: "[nagłówek]", items: [{ value: "[liczba]", label: "[opis]" }, { value: "[liczba]", label: "[opis]" }] }, theme, themeStyle),
    },
    {
      key: "background",
      title: "Tło AI za ekspertem",
      when: "Przycisk „Wygeneruj tło” w Studio (Nagrania → Tło za ekspertem → Tło AI).",
      prompt: backgroundPrompt({ idea: "[Twój pomysł na tło — opcjonalnie]", question: "[pytanie widza]", category: "[kategoria]" }, theme, themeStyle),
    },
    {
      key: "caller",
      title: "Zdjęcie rozmówcy (pytanie jak rozmowa)",
      when: "Przycisk „Wygeneruj zdjęcie (OpenAI)” w sekcji „Pytanie jak rozmowa”.",
      prompt: callerAvatarPrompt({ gender: "female", name: "[imię]" }).replace("a Polish woman", "a Polish woman / man"),
    },
  ];
  const styles = [
    { scope: "Motyw projektu (domyślny)", style: themeStyle },
    ...project.categories.map((c) => ({ scope: `Kategoria: ${c.name}`, style: c.brollStyle?.trim() ? fillStyle(c.brollStyle.trim(), theme) : null })),
  ];
  return json({ items, styles });
});
