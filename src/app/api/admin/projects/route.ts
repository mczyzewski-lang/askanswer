import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { ProjectInput } from "@/lib/server/schemas";
import { THEME_PRESETS } from "@/lib/themes";
import { dashboardData } from "@/lib/server/project-data";

const DEFAULT_CATEGORIES = ["Znaki towarowe", "Upadłość konsumencka", "Restrukturyzacja", "Rozwody", "Psychoterapia", "Ogólne"];

export const POST = route(async (req: Request) => {
  await requireAdmin();
  const raw = await req.json();
  const body = ProjectInput.parse(raw);
  // each project gets its own editable theme, initialised from a preset
  const presetKey = typeof raw?.preset === "string" ? raw.preset : undefined;
  const preset = THEME_PRESETS.find((t) => t.key === presetKey) ?? THEME_PRESETS[0];
  const theme = await prisma.theme.create({
    data: {
      name: `${preset.name} (${body.name.slice(0, 40)})`,
      presetKey: preset.key,
      primaryColor: preset.primary,
      accentColor: preset.accent,
      secondaryColor: preset.secondary,
      textColor: preset.text,
      highlightColor: preset.highlight,
      backgroundColor: preset.background,
      questionFont: preset.questionFont,
      subtitleFont: preset.subtitleFont,
      labelFont: preset.labelFont,
    },
  });
  const project = await prisma.project.create({
    data: { ...body, themeId: theme.id, categories: { create: DEFAULT_CATEGORIES.map((name, order) => ({ name, order })) } },
  });
  return json(project, 201);
});

export const GET = route(async () => {
  await requireAdmin();
  return json(await dashboardData());
});
