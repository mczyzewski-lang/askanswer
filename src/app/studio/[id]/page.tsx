import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentUser, denyReason } from "@/lib/server/auth";
import { Studio } from "@/components/studio/studio";

export const metadata: Metadata = { title: "Studio — AskBy Studio" };
export const dynamic = "force-dynamic";

export default async function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  // only people with access to the video's project
  const denied = await denyReason(user, `/studio/${id}`, "GET");
  if (denied)
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center" data-testid="access-denied">
        <div>
          <p className="font-display text-xl font-semibold">Brak dostępu</p>
          <p className="mt-2 text-sm text-muted">{denied}.</p>
          <a href="/admin" className="mt-4 inline-block text-sm underline">
            Wróć do projektów
          </a>
        </div>
      </main>
    );
  return <Studio id={id} />;
}
