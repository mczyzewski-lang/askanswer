import { Suspense } from "react";
import { currentUser, denyReason } from "@/lib/server/auth";
import { AccessDenied } from "@/components/admin/access-denied";
import { AdwordsProject } from "@/components/adwords/adwords";

export const dynamic = "force-dynamic";

export default async function AdwordsProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  const denied = me ? await denyReason(me, `/admin/adwords/${id}`, "GET") : "Wymagane logowanie";
  if (denied) return <AccessDenied reason={denied} />;
  return (
    <Suspense>
      <AdwordsProject projectId={id} />
    </Suspense>
  );
}
