import { requireAdmin } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { metaZip } from "@/lib/server/meta-ads";

export const runtime = "nodejs";
export const maxDuration = 300;

/** the package for Ads Manager: ?ads=id,id (none = all) &fmt=png|jpg */
export const GET = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const q = new URL(req.url).searchParams;
  const z = await metaZip(projectId, (q.get("ads") ?? "").split(",").filter(Boolean), q.get("fmt") === "jpg" ? "jpg" : "png");
  return new Response(new Uint8Array(z.zip), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${z.name}"`, "Cache-Control": "no-store" } });
});
