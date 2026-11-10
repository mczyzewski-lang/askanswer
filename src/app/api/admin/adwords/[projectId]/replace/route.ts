import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { syncScriptColumns } from "@/lib/server/adwords";

const AD_FIELDS = ["headline", "subheadline", "body", "cta", "adText", "spokenText", "screenText"] as const;
const META_FIELDS = ["headline", "primaryText", "metaHeadline", "description", "ctaImage", "badgeText"] as const;
const LABEL: Record<string, string> = { headline: "hasło", subheadline: "podtytuł", body: "dopisek / kroki", cta: "CTA", adText: "tekst", spokenText: "lektor", screenText: "napis", primaryText: "tekst główny", metaHeadline: "nagłówek Meta", description: "opis", ctaImage: "CTA na grafice", badgeText: "plakietka" };

/**
 * Find and replace in every text of the module (Google creatives, texts, scenes, Meta ads) —
 * apply=false only lists what would change.
 */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ find: z.string().min(2).max(200), replace: z.string().max(200), apply: z.boolean().default(false), caseSensitive: z.boolean().default(false) }).parse(await req.json());
  const re = new RegExp(b.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), b.caseSensitive ? "g" : "gi");
  const changes: Array<{ kind: "google" | "meta"; id: string; label: string; field: string; before: string; after: string }> = [];
  const assets = await prisma.adwordsAsset.findMany({ where: { projectId, rowType: { not: "landing_page" } } });
  for (const a of assets)
    for (const f of AD_FIELDS) {
      const v = a[f];
      if (v && re.test(v)) changes.push({ kind: "google", id: a.id, label: `${a.assetKey}`, field: f, before: v, after: v.replace(re, b.replace) });
      re.lastIndex = 0;
    }
  const metas = await prisma.metaAd.findMany({ where: { projectId } });
  for (const m of metas)
    for (const f of META_FIELDS) {
      const v = m[f];
      if (v && re.test(v)) changes.push({ kind: "meta", id: m.id, label: `Meta: ${m.name}`, field: f, before: v, after: v.replace(re, b.replace) });
      re.lastIndex = 0;
    }
  if (b.apply) {
    const scenes = new Set<string>();
    for (const c of changes) {
      if (c.kind === "google") {
        await prisma.adwordsAsset.update({ where: { id: c.id }, data: { [c.field]: c.after } });
        const a = assets.find((x) => x.id === c.id);
        if (a?.rowType === "video_scene" && a.conceptId) scenes.add(a.conceptId);
      } else await prisma.metaAd.update({ where: { id: c.id }, data: { [c.field]: c.after } });
    }
    for (const c of scenes) await syncScriptColumns(projectId, c);
  }
  return json({ applied: b.apply, count: changes.length, changes: changes.map((c) => ({ ...c, fieldLabel: LABEL[c.field] ?? c.field })) });
});
