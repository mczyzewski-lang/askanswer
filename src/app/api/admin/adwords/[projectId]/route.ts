import { requireAdmin, canEdit } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { adwordsProject, defaultBrief, evaluateProject, layoutOf, photoUrl, projectTopic, toAdAsset } from "@/lib/server/adwords";
import { historyOf } from "@/lib/server/adwords-history";
import { gateLpOf, isV5Project, landingContext } from "@/lib/server/adwords-landing";
import { PMAX_SPEC } from "@/lib/adwords/spec";
import { SCORING_B } from "@/lib/adwords/score";
import { slugify } from "@/lib/adwords/csv";
import { themeFromRow, DEFAULT_THEME } from "@/lib/themes";
import { prisma } from "@/lib/server/db";
import { signedUrl } from "@/lib/server/storage";

/** Everything the "Google Adwords" pages show for a project. */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  const me = await requireAdmin();
  const { projectId } = await ctx.params;
  const { project, assets, photos, campaigns } = await adwordsProject(projectId);
  const theme = project.theme ? themeFromRow(project.theme) : DEFAULT_THEME;
  const logo = project.theme?.logoAssetId ? await prisma.mediaAsset.findUnique({ where: { id: project.theme.logoAssetId } }) : null;
  const evaluation = await evaluateProject(projectId);
  const list = assets.map(toAdAsset);
  const history = await historyOf(projectId);
  const lctx = await landingContext(projectId);
  // the AI infographic versions: their pictures through signed links
  const infoIds = assets.map((a) => ((a.edit ?? {}) as { infographicAssetId?: string }).infographicAssetId).filter((x): x is string => !!x);
  const infoUrls = new Map(await Promise.all((await prisma.mediaAsset.findMany({ where: { id: { in: infoIds } } })).map(async (m) => [m.id, await signedUrl(m.storageKey, { ttlSec: 6 * 3600 })] as const)));
  const latest = history.imports[0];
  const period = latest?.periodFrom && latest.periodTo ? `${latest.periodFrom.toISOString().slice(0, 10)} – ${latest.periodTo.toISOString().slice(0, 10)}` : "okres raportu";
  return json({
    project: { id: project.id, name: project.name, slug: slugify(project.name), themeId: project.themeId, brief: project.adwordsBrief, topic: projectTopic(project, assets), topicSet: project.adwordsTopic, defaultBrief: defaultBrief(project, { campaigns, assets: list, evaluation, history: history.rows, period }) },
    history,
    landing: { offer: lctx.offer, claims: lctx.claims, variants: lctx.variants, settings: lctx.settings },
    gateLp: gateLpOf(isV5Project(assets), lctx),
    me: { email: me.email },
    canEdit: canEdit(me.role),
    theme,
    logoUrl: logo ? await signedUrl(logo.storageKey, { ttlSec: 6 * 3600 }) : null,
    campaigns,
    assets: assets.map((a) => ({ ...a, effectiveLayout: a.rowType === "image" || a.rowType === "image_clean" ? layoutOf(a) : null, infographicUrl: infoUrls.get(((a.edit ?? {}) as { infographicAssetId?: string }).infographicAssetId ?? "") ?? null })),
    photos: await Promise.all(photos.map(async (p) => ({ ...p, url: await photoUrl(p.assetId) }))),
    evaluation,
    spec: PMAX_SPEC,
    scoringB: SCORING_B,
  });
});
