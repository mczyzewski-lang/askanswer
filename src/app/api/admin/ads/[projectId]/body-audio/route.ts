import { requireAdmin } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { bodyAudioZip } from "@/lib/server/ads";

export const maxDuration = 300;

/** Only the audio of the bodies (no hooks, no CTA): one MP3 per reel, cut from the footage, as a ZIP. */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const { zip, name } = await bodyAudioZip(projectId);
  return new Response(new Uint8Array(zip), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } });
});
