import { requireAdmin } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { adwordsProject } from "@/lib/server/adwords";
import { adwordsCsvTemplate, exportAdwordsCsv, slugify } from "@/lib/adwords/csv";

/** Export the module's records as CSV (the same columns as the import), or the template (?template=1). */
export const GET = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const { project, assets } = await adwordsProject(projectId);
  const slug = slugify(project.name);
  const template = new URL(req.url).searchParams.get("template") === "1";
  const body = template ? adwordsCsvTemplate(slug) : exportAdwordsCsv(assets.map((a) => ({ ...a, extra: (a.extra ?? null) as Record<string, string> | null })), slug);
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${slug}_google_adwords${template ? "_szablon" : ""}.csv"` } });
});
