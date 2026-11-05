import { currentUser, denyReason } from "@/lib/server/auth";
import { AccessDenied } from "@/components/admin/access-denied";
import { EduList } from "@/components/admin/edu-studio";

export default async function EduPage() {
  const me = await currentUser();
  const denied = me ? await denyReason(me, "/admin/edu", "GET") : "Wymagane logowanie";
  if (denied) return <AccessDenied reason={denied} />;
  return <EduList />;
}
