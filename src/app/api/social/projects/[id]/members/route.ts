import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { projectAccess } from "@/lib/server/social/access";
import { invite } from "@/lib/server/social/projects";
import { ORG_ROLES } from "@/lib/social/rbac";

/** invite a person to this project only (e.g. the client who approves) */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await projectAccess(id, "members.manage");
  const b = z.object({ email: z.string().email(), name: z.string().max(120).optional(), role: z.enum(ORG_ROLES.filter((r) => r !== "OWNER") as [string, ...string[]]) }).parse(await req.json());
  return json(await invite({ email: b.email, name: b.name, role: b.role as never, projectId: id, invitedById: a.user.id }), 201);
});
