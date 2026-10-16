import { z } from "zod";
import { ensureProjectExpert } from "@/lib/server/project-experts";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { createInvitation } from "@/lib/server/invitations";

/** Create a new secure recording link for an expert (previous active links stay valid until revoked). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id: projectId } = await ctx.params;
  const { expertId, ttlDays } = z.object({ expertId: z.string(), ttlDays: z.number().int().min(1).max(365).optional() }).parse(await req.json());
  await prisma.expert.findUniqueOrThrow({ where: { id: expertId } });
  await ensureProjectExpert(projectId, expertId);
  const { invitation, url } = await createInvitation(projectId, expertId, ttlDays);
  return json({ id: invitation.id, url, expiresAt: invitation.expiresAt }, 201);
});
