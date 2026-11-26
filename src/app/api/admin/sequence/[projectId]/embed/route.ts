import { z } from "zod";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { embedData, publishEmbeds } from "@/lib/server/embed";

const kindOf = (v: string | null) => (v === "testimonial" ? "testimonial" : "sequence");

/** Embedding: the codes, what is published, the viewing numbers. */
export const GET = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const u = new URL(req.url);
  return json(await embedData(projectId, kindOf(u.searchParams.get("kind")), req.headers.get("x-forwarded-host") ? `${req.headers.get("x-forwarded-proto") ?? "https"}://${req.headers.get("x-forwarded-host")}` : u.origin));
});

/** Publish (or refresh) the films' files for the players: with and without the end card. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ kind: z.enum(["sequence", "testimonial"]).default("sequence"), filmIds: z.array(z.string().max(64)).max(200).optional() }).parse(await req.json().catch(() => ({})));
  return json(await publishEmbeds(projectId, b.kind, b.filmIds), 201);
});
