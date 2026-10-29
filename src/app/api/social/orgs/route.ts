import { z } from "zod";
import { isStaff, requireUser, HttpError } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { createOrganization } from "@/lib/server/social/projects";

/** a new organization (client) — platform staff only */
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  if (!isStaff(user.role)) throw new HttpError(403, "Organizacje zakłada operator platformy.");
  const b = z.object({ name: z.string().trim().min(2).max(120) }).parse(await req.json());
  const org = await createOrganization(b.name, user.id);
  return json({ id: org.id, name: org.name }, 201);
});
