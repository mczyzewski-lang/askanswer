import { dashboardData } from "@/lib/server/project-data";
import { Dashboard } from "@/components/admin/dashboard";

export const dynamic = "force-dynamic";

/** Ads recorded by the expert from the prompter (several hooks per reel). */
export default async function AdsRecordingHome() {
  const projects = await dashboardData({ adsRecording: true });
  return <Dashboard projects={projects} ads />;
}
