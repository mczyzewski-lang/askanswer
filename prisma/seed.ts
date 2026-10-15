/**
 * Demo content (Polish). Creates the admin account, theme presets, the demo
 * project "Pravna — Znaki Towarowe" with sample questions, an expert and an
 * invitation link. No fake recordings are created — recordings come only from
 * real camera uploads (or clearly labelled test fixtures in automated tests).
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/server/crypto";
import { THEME_PRESETS } from "../src/lib/themes";
import { createInvitation } from "../src/lib/server/invitations";

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "admin@askby.local").toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "askby-admin";
  await prisma.user.upsert({
    where: { email },
    create: { email, name: "Administrator", passwordHash: await hashPassword(password) },
    update: {},
  });

  const themes: Record<string, string> = {};
  for (const t of THEME_PRESETS) {
    const existing = await prisma.theme.findFirst({ where: { presetKey: t.key, isPreset: true } });
    const data = {
      name: t.name,
      presetKey: t.key,
      isPreset: true,
      primaryColor: t.primary,
      accentColor: t.accent,
      secondaryColor: t.secondary,
      textColor: t.text,
      highlightColor: t.highlight,
      backgroundColor: t.background,
      questionFont: t.questionFont,
      subtitleFont: t.subtitleFont,
      labelFont: t.labelFont,
    };
    const row = existing ? existing : await prisma.theme.create({ data });
    themes[t.key] = row.id;
  }

  const projectName = "Pravna — Znaki Towarowe";
  let project = await prisma.project.findFirst({ where: { name: projectName } });
  if (!project) {
    const projectTheme = await prisma.theme.create({
      data: {
        name: "Pravna (projekt)",
        presetKey: "pravna",
        primaryColor: THEME_PRESETS[0].primary,
        accentColor: THEME_PRESETS[0].accent,
        secondaryColor: THEME_PRESETS[0].secondary,
        textColor: THEME_PRESETS[0].text,
        highlightColor: THEME_PRESETS[0].highlight,
        backgroundColor: THEME_PRESETS[0].background,
        questionFont: THEME_PRESETS[0].questionFont,
        subtitleFont: THEME_PRESETS[0].subtitleFont,
        labelFont: THEME_PRESETS[0].labelFont,
      },
    });
    project = await prisma.project.create({
      data: {
        name: projectName,
        description: "Ekspert odpowiada na najczęstsze pytania o ochronę znaków towarowych.",
        themeId: projectTheme.id,
        recordingMode: "CONTINUOUS",
        questionVisibility: "FULL",
      },
    });
    const catNames = ["Znaki towarowe", "Upadłość konsumencka", "Restrukturyzacja", "Rozwody", "Psychoterapia", "Ogólne"];
    const cats: Record<string, string> = {};
    for (const [i, name] of catNames.entries()) {
      const c = await prisma.category.create({ data: { name, projectId: project.id, order: i } });
      cats[name] = c.id;
    }
    const expert = await prisma.expert.create({ data: { name: "Anna Kowalska", email: "anna.kowalska@example.com", title: "Radczyni prawna, rzecznik patentowy" } });
    const questions: Array<{ text: string; instructions?: string; max?: number }> = [
      { text: "Dlaczego warto zastrzec znak towarowy?", instructions: "Odpowiedz krótko, podając 2–3 najważniejsze korzyści.", max: 60 },
      { text: "Co się stanie, jeśli konkurencja zarejestruje moją nazwę?", max: 75 },
      { text: "Ile kosztuje rejestracja znaku towarowego?", instructions: "Podaj orientacyjne opłaty urzędowe w Polsce i UE.", max: 60 },
      { text: "Jak długo trwa ochrona znaku?", max: 45 },
      { text: "Czy mogę zastrzec nazwę firmy?", max: 60 },
      { text: "Czy warto zastrzec znak również na terenie Unii Europejskiej?", max: 75 },
      { text: "Jakie są najczęstsze błędy podczas rejestracji znaku?", max: 90 },
    ];
    for (const [i, q] of questions.entries()) {
      await prisma.question.create({
        data: { projectId: project.id, categoryId: cats["Znaki towarowe"], expertId: expert.id, text: q.text, instructions: q.instructions, maxDurationSec: q.max, order: i },
      });
    }
    const inv = await createInvitation(project.id, expert.id);
    console.log(`\nDemo recording link for ${expert.name}:\n  ${inv.url}\n`);
  }
  console.log(`Admin login: ${email} / ${password === "askby-admin" ? "askby-admin" : "(z ADMIN_PASSWORD)"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
