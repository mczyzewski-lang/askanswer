import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/auth";
import { elevenLabsConfigured } from "@/lib/server/env";
import { AdminNav } from "@/components/admin/nav";
import { ActivityNotifier } from "@/components/admin/activity-notifier";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/admin" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink font-display text-sm font-bold text-white">A</span>
            <span className="font-display text-[15px] font-semibold">AskBy Studio</span>
          </Link>
          <AdminNav />
          <div className="ml-auto flex items-center gap-3 text-sm">
            {!elevenLabsConfigured() ? (
              <span className="hidden rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 md:inline" title="Ustaw ELEVENLABS_API_KEY w .env">
                ElevenLabs: brak konfiguracji
              </span>
            ) : null}
            <span className="hidden text-muted sm:inline">{user.email}</span>
            <form action="/api/auth/logout" method="post">
              <button className="rounded-lg px-2 py-1 text-muted hover:bg-black/5 hover:text-ink">Wyloguj</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
      <ActivityNotifier />
    </div>
  );
}
