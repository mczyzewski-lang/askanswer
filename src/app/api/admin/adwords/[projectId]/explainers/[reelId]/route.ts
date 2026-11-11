import { requireAdmin } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { explainerFrame } from "@/lib/server/explainers";
import { reelById } from "@/lib/explainers";

export const runtime = "nodejs";

/** one frame of the reel as PNG: ?t=seconds (default: the first readable frame) — the thumbnail */
export const GET = route(async (req: Request, ctx: { params: Promise<{ projectId: string; reelId: string }> }) => {
  await requireAdmin();
  const { projectId, reelId } = await ctx.params;
  const u = new URL(req.url);
  const t = Number(u.searchParams.get("t") ?? "1.2");
  const png = await explainerFrame(projectId, reelId, Number.isFinite(t) ? t : 1.2);
  const n = reelById(reelId)?.n ?? 0;
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store", ...(u.searchParams.get("download") ? { "Content-Disposition": `attachment; filename="nowy-etap_explainer-${String(n).padStart(2, "0")}_${reelId}_kadr.png"` } : {}) } });
});
