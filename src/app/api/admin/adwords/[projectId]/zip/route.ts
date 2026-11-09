import { requireAdmin } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { adwordsZip } from "@/lib/server/adwords";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Every image (PNG or JPG), the manifest (CSV + JSON), the CSV, subtitles, teleprompter, shot list and brief. */
export const GET = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const fmt = new URL(req.url).searchParams.get("fmt") === "jpg" ? "jpg" : "png";
  const z = await adwordsZip(projectId, fmt);
  return new Response(new Uint8Array(z.zip), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${z.name}"`, "Cache-Control": "no-store" } });
});
