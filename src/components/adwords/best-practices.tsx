"use client";
import { Lightbulb } from "lucide-react";
import { PRACTICES, PRACTICES_CHECKED_AT, type Practice } from "@/lib/adwords/best-practices";

const GROUPS = { google: "Google Ads — Performance Max / Demand Gen", meta: "Meta — Facebook / Instagram", legal: "Kancelarie / usługi prawne", webinar: "Promocja webinaru" } as const;

/** fold-out good practices of 2026 for the platform, with sources (official vs industry) */
export function BestPractices({ platform }: { platform: "google" | "meta" }) {
  const groups = platform === "google" ? (["google", "legal"] as const) : (["meta", "webinar", "legal"] as const);
  return (
    <details className="rounded-xl border border-line bg-white px-4 py-3" data-testid={`best-practices-${platform}`}>
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <Lightbulb className="h-4 w-4 text-amber-600" /> Dobre praktyki kreacji 2026 — {platform === "google" ? "Google Ads (PMax)" : "Meta / FB / IG"}
      </summary>
      <div className="mt-3 space-y-4">
        {groups.map((g) => (
          <div key={g} className="space-y-1.5">
            <p className="text-sm font-medium">{GROUPS[g]}</p>
            <ul className="space-y-1.5">
              {PRACTICES[g].map((p: Practice, i: number) => (
                <li key={i} className="flex gap-2 text-sm leading-snug">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${/^Unikaj|^Uważaj|^Uwaga/.test(p.text) ? "bg-red-400" : "bg-emerald-500"}`} />
                  <span>
                    {p.text}{" "}
                    <a href={p.source} target="_blank" rel="noreferrer" className="whitespace-nowrap text-xs text-muted underline">
                      {p.official ? "źródło oficjalne" : "źródło branżowe"}
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-xs text-muted">Research z {PRACTICES_CHECKED_AT}. „Źródło oficjalne” = strona Google / Meta; liczby z blogów branżowych traktuj orientacyjnie. Zasady etyki adwokatów i radców potwierdź w aktualnych tekstach NRA / KRRP.</p>
      </div>
    </details>
  );
}
