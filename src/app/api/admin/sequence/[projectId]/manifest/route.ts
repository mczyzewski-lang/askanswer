import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { importManifest, Manifest } from "@/lib/server/sequence";

export const maxDuration = 300;

/** The package's manifest.json: which clips make which film (and version). ?rebuild=1 lays every edit out again. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const parsed = Manifest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: `manifest.json ma nieprawidłową strukturę: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}` }, 400);
  return json(await importManifest(projectId, parsed.data, { rebuild: new URL(req.url).searchParams.get("rebuild") === "1" }));
});
