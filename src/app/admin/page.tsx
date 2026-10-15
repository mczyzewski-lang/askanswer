import { dashboardData } from "@/lib/server/project-data";
import { Dashboard } from "@/components/admin/dashboard";

export default async function AdminHome() {
  const projects = await dashboardData();
  return <Dashboard projects={projects} />;
}
