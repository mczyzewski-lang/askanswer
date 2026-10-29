"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui";
import { api } from "@/lib/utils";
import { PLATFORMS, PLATFORM_META, type Platform } from "@/lib/social/platforms";
import { DemoBadge, ErrorBox, PlatformIcon } from "@/components/social/ui";

/** DEMO stand-in for the provider's OAuth page: "connects" demo accounts, then returns */
export default function DemoConnect() {
  const q = useSearchParams();
  const wanted = (q.get("platforms") ?? "").split(",").filter((p): p is Platform => (PLATFORMS as string[]).includes(p));
  const [chosen, setChosen] = React.useState<Platform[]>(wanted);
  const [error, setError] = React.useState<string | null>(null);
  const redirect = q.get("redirect") ?? "/social";
  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-2xl border border-line bg-white p-6">
        <p className="flex items-center gap-2 font-display text-lg font-semibold">
          Połącz konta <DemoBadge />
        </p>
        <p className="mt-1 text-sm text-muted">To symulacja strony autoryzacji dostawcy. W trybie DEMO nic nie jest łączone z prawdziwymi kontami i nic nie zostanie opublikowane.</p>
        <div className="mt-4 space-y-2">
          {(wanted.length ? wanted : PLATFORMS).map((p) => (
            <label key={p} className="flex items-center gap-3 rounded-xl border border-line p-3">
              <input type="checkbox" checked={chosen.includes(p)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p] : c.filter((x) => x !== p)))} />
              <PlatformIcon platform={p} /> {PLATFORM_META[p].name}
            </label>
          ))}
        </div>
        {error ? <div className="mt-3"><ErrorBox error={error} /></div> : null}
        <Button
          className="mt-4 w-full"
          data-testid="demo-authorize"
          disabled={!chosen.length}
          onClick={async () => {
            try {
              await api("/api/social/demo-connect", { method: "POST", json: { profile: q.get("profile"), platforms: chosen } });
              // only back into this app
              window.location.href = redirect.startsWith(window.location.origin) || (redirect.startsWith("/") && !redirect.startsWith("//")) ? redirect : "/social";
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Autoryzuj (DEMO)
        </Button>
      </div>
    </div>
  );
}
