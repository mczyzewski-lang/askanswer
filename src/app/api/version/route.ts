import { appCommit } from "@/lib/server/version";

export const dynamic = "force-dynamic";

/** Which version is running — to check that a deploy went through. */
export function GET() {
  return Response.json({ commit: appCommit() || null, branch: process.env.RAILWAY_GIT_BRANCH ?? null, deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null });
}
