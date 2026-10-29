import { isStaff, requireUser, HttpError } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { seedDemo } from "@/lib/server/social/demo";

export const runtime = "nodejs";
export const maxDuration = 300;

/** load the DEMO organization (3 projects) — platform staff */
export const POST = route(async () => {
  const user = await requireUser();
  if (!isStaff(user.role)) throw new HttpError(403, "Brak dostępu");
  const org = await seedDemo(user.id);
  return json({ id: org.id });
});
