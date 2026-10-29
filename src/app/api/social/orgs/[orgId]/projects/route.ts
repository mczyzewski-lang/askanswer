import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { orgAccess } from "@/lib/server/social/access";
import { createProject } from "@/lib/server/social/projects";

export const POST = route(async (req: Request, ctx: { params: Promise<{ orgId: string }> }) => {
  const { orgId } = await ctx.params;
  const a = await orgAccess(orgId, "project.create");
  const b = z.object({ name: z.string().trim().min(2).max(120), timezone: z.string().max(60).optional(), language: z.enum(["pl", "en"]).optional() }).parse(await req.json());
  if (b.timezone) Intl.DateTimeFormat("pl-PL", { timeZone: b.timezone });
  const p = await createProject(orgId, b.name, a.user.id, { timezone: b.timezone, language: b.language, isDemo: a.organization.isDemo || undefined });
  return json({ id: p.id, name: p.name, isDemo: p.isDemo }, 201);
});
