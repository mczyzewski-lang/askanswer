import { currentUser, denyReason } from "@/lib/server/auth";
import { AccessDenied } from "@/components/admin/access-denied";
import { UsersView } from "@/components/admin/users-view";

export default async function UsersPage() {
  const me = await currentUser();
  const denied = me ? await denyReason(me, "/admin/users", "GET") : "Wymagane logowanie";
  if (denied) return <AccessDenied reason={denied} />;
  return <UsersView />;
}
