import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { HttpError } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { projectAccess } from "@/lib/server/social/access";
import { demoConnect } from "@/lib/server/social/provider/mock";
import { demoMode } from "@/lib/server/social/provider";
import { PLATFORMS } from "@/lib/social/platforms";

/** the DEMO "OAuth" page: connects demo accounts to a DEMO profile (never a real one) */
export const POST = route(async (req: Request) => {
  const b = z.object({ profile: z.string().max(120), platforms: z.array(z.enum(PLATFORMS as [string, ...string[]])).min(1), reauth: z.boolean().optional() }).parse(await req.json());
  const profile = await prisma.providerProfile.findUnique({ where: { username: b.profile } });
  if (!profile) throw new HttpError(404, "Nie znaleziono profilu");
  const a = await projectAccess(profile.projectId, "accounts.manage");
  if (!profile.isDemo && !demoMode()) throw new HttpError(400, "To nie jest profil DEMO.");
  await demoConnect(profile.username, b.platforms as never, a.project.name);
  return json({ ok: true });
});
