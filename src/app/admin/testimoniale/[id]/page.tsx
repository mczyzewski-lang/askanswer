import { currentUser, denyReason } from "@/lib/server/auth";
import { AccessDenied } from "@/components/admin/access-denied";
import { SequenceView } from "@/components/admin/sequence";

export default async function TestimonialsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  const denied = me ? await denyReason(me, `/admin/testimoniale/${id}`, "GET") : "Wymagane logowanie";
  if (denied) return <AccessDenied reason={denied} />;
  return <SequenceView id={id} kind="testimonial" />;
}
