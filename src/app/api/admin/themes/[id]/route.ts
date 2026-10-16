import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { THEME_PRESETS, FONT_FAMILIES } from "@/lib/themes";

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
      brollStyle: z.string().trim().max(4000).nullable().optional().transform((v) => (v === "" ? null : v)),
      applyPreset: z.string().optional(),
    })
    .parse(raw);
  const theme = await prisma.theme.findUniqueOrThrow({ where: { id } });
  if (theme.isPreset) return json({ error: "Motywy wbudowane są tylko do odczytu — edytuj motyw projektu." }, 400);
  const { applyPreset, ...data } = body;
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
  }
  return json(await prisma.theme.update({ where: { id }, data }));
});
