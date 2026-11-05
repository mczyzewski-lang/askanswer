import { currentUser, denyReason } from "@/lib/server/auth";
import { AccessDenied } from "@/components/admin/access-denied";
import { AdsProject } from "@/components/admin/ads-studio";

export default async function AdsProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  const denied = me ? await denyReason(me, `/admin/ads/${id}`, "GET") : "Wymagane logowanie";
  if (denied) return <AccessDenied reason={denied} />;
  return <AdsProject id={id} />;
}
