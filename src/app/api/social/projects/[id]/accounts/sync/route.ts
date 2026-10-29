import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { projectAccess } from "@/lib/server/social/access";
import { syncProfile, syncProject } from "@/lib/server/social/accounts";

/** read connected accounts back from the provider (after returning from the connect page, or on demand) */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await projectAccess(id, "accounts.manage");
  const b = z.object({ profileId: z.string().max(64).nullish() }).parse(await req.json().catch(() => ({})));
  if (b.profileId) {
    const p = await prisma.providerProfile.findFirst({ where: { id: b.profileId, projectId: id } });
    if (!p) return json({ error: "Nie znaleziono profilu" }, 404);
    return json(await syncProfile(p.id, a.user.id));
  }
  return json({ changes: await syncProject(id, a.user.id) });
});
