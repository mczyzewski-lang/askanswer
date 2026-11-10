import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { THEME_PRESETS, FONT_FAMILIES } from "@/lib/themes";
import { presetLogos } from "@/lib/server/preset-logo";
import { isBasePrompt } from "@/lib/infographic-prompt";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Kolor musi mieć format #RRGGBB");
const fontName = z.enum(FONT_FAMILIES);

export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const raw = await req.json();
  const body = z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      primaryColor: hex.optional(),
      accentColor: hex.optional(),
      secondaryColor: hex.optional(),
      textColor: hex.optional(),
      highlightColor: hex.optional(),
      backgroundColor: hex.optional(),
      questionFont: fontName.optional(),
      subtitleFont: fontName.optional(),
      labelFont: fontName.optional(),
      logoAssetId: z.string().nullable().optional(),
      logoDarkAssetId: z.string().nullable().optional(),
      /** put the brand logos of a preset (both versions) without touching the colours */
      presetLogos: z.string().optional(),
      questionStyle: z.enum(["card", "plain", "outline", "accent", "pill"]).optional(),
      questionPosition: z.enum(["top", "center", "lower"]).optional(),
      brollStyle: z.string().trim().max(4000).nullable().optional().transform((v) => (v === "" ? null : v)),
      // the infographic prompt template; the base one (or empty) is stored as null = follows the code
      infographicPrompt: z.string().max(8000).nullable().optional().transform((v) => (v === undefined ? undefined : v === null || isBasePrompt(v) ? null : v.replace(/\r\n/g, "\n").trim())),
      applyPreset: z.string().optional(),
    })
    .parse(raw);
  const theme = await prisma.theme.findUniqueOrThrow({ where: { id } });
  if (theme.isPreset) return json({ error: "Motywy wbudowane są tylko do odczytu — edytuj motyw projektu." }, 400);
  const { applyPreset, presetLogos: logosOf, ...data } = body;
  if (logosOf) {
    const project = await prisma.project.findFirst({ where: { themeId: id }, select: { id: true } });
    const logos = await presetLogos(logosOf, project?.id ?? null);
    if (!Object.keys(logos).length) return json({ error: "Ten preset nie ma logo" }, 400);
    Object.assign(data, logos);
  }
  if (applyPreset) {
    const p = THEME_PRESETS.find((t) => t.key === applyPreset);
    if (!p) return json({ error: "Nieznany preset" }, 400);
    Object.assign(data, {
      presetKey: p.key,
      primaryColor: p.primary,
      accentColor: p.accent,
      secondaryColor: p.secondary,
      textColor: p.text,
      highlightColor: p.highlight,
      backgroundColor: p.background,
      questionFont: p.questionFont,
      subtitleFont: p.subtitleFont,
      labelFont: p.labelFont,
    });
    // a preset with its brand logo brings it along; other presets keep the current logo
    if (p.logoFile || p.logoDarkFile) {
      const project = await prisma.project.findFirst({ where: { themeId: id }, select: { id: true } });
      Object.assign(data, await presetLogos(p.key, project?.id ?? null));
    }
  }
  return json(await prisma.theme.update({ where: { id }, data }));
});

/** Delete a theme no project uses (leftovers of deleted projects). */
export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const t = await prisma.theme.findUniqueOrThrow({ where: { id }, select: { isPreset: true, _count: { select: { projects: true } } } });
  if (t.isPreset) return json({ error: "Presetów nie można usunąć" }, 400);
  if (t._count.projects) return json({ error: "Ten motyw jest używany przez projekt" }, 409);
  await prisma.theme.delete({ where: { id } });
  return json({ ok: true });
});
