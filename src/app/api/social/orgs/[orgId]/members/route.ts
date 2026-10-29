import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { orgAccess } from "@/lib/server/social/access";
import { invite } from "@/lib/server/social/projects";
import { ORG_ROLES } from "@/lib/social/rbac";

/** invite a person to the whole organization */
export const POST = route(async (req: Request, ctx: { params: Promise<{ orgId: string }> }) => {
  const { orgId } = await ctx.params;
  const a = await orgAccess(orgId, "members.manage");
  const b = z.object({ email: z.string().email(), name: z.string().max(120).optional(), role: z.enum(ORG_ROLES as [string, ...string[]]) }).parse(await req.json());
  if (b.role === "OWNER" && a.role !== "OWNER") return json({ error: "Tylko właściciel może nadać rolę właściciela." }, 403);
  return json(await invite({ email: b.email, name: b.name, role: b.role as never, organizationId: orgId, invitedById: a.user.id }), 201);
});
