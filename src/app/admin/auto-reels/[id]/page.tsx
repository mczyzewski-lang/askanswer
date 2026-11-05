import { currentUser, denyReason } from "@/lib/server/auth";
import { AccessDenied } from "@/components/admin/access-denied";
import { AutoReelsProject } from "@/components/admin/auto-reels";

export default async function AutoReelsProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  const denied = me ? await denyReason(me, `/admin/auto-reels/${id}`, "GET") : "Wymagane logowanie";
  if (denied) return <AccessDenied reason={denied} />;
  return <AutoReelsProject id={id} />;
}
