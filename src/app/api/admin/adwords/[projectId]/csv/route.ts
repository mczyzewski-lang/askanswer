import { requireAdmin } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { adwordsProject, projectCsv } from "@/lib/server/adwords";
import { adwordsCsvTemplate, slugify } from "@/lib/adwords/csv";

/** Export the module's records as CSV (the same columns as the import), or the template (?template=1). */
export const GET = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const { project } = await adwordsProject(projectId);
  const slug = slugify(project.name);
  // ?template=1 → the v5 template (all columns, one example of each kind); ?template=v1 → the old 30 columns
  const t = new URL(req.url).searchParams.get("template");
  const template = t === "1" || t === "v5" || t === "v1";
  const body = template ? adwordsCsvTemplate(slug, t === "v1" ? "v1" : "v5") : await projectCsv(projectId);
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${slug}_google_adwords${template ? (t === "v1" ? "_szablon_v1" : "_szablon_v5") : ""}.csv"` } });
});
