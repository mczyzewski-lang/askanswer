import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { chunkIndex, saveChunk } from "@/lib/server/chunked";
import { HttpError } from "@/lib/server/errors";

export const runtime = "nodejs";

/** One slice of a clip of the package (a request carries at most a few MB; re-sending a slice overwrites it). */
export const PUT = route(async (req: Request, ctx: { params: Promise<{ projectId: string; upload: string; index: string }> }) => {
  await requireAdmin();
  const { projectId, upload, index } = await ctx.params;
  if (!/^[a-z0-9]{8,40}$/.test(upload)) throw new HttpError(400, "Nieprawidłowy identyfikator wysyłki");
  await saveChunk("seq-uploads", `${projectId}-${upload}`, chunkIndex(index), req);
  return json({ ok: true });
});
