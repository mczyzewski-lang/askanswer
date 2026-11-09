"use client";
import { useState } from "react";
import type { Gate, Score } from "@/lib/adwords/score";
import { cn } from "@/lib/utils";

const tone = (n: number) => (n >= 80 ? "bg-emerald-50 text-emerald-700" : n >= 60 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700");

export function GateBadge({ gate }: { gate: Gate }) {
  const map = { gotowe: "bg-emerald-50 text-emerald-700", do_poprawy: "bg-amber-50 text-amber-800", blokada: "bg-red-50 text-red-700" };
  const label = { gotowe: "gotowe", do_poprawy: "do poprawy", blokada: "blokada" };
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", map[gate.status])} title={gate.problems.map((p) => `• ${p.message}`).join("\n")} data-testid="gate" data-status={gate.status}>
      {label[gate.status]}
    </span>
  );
}

/** Scores A and B side by side (never averaged); click for the breakdown. */
export function ScorePair({ a, b, seed, compact }: { a: Score | null; b: Score | null; seed?: number | null; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!a || !b) return null;
  return (
    <div className="text-xs" data-testid="score-pair">
      <button type="button" className="flex items-center gap-1.5" onClick={() => setOpen((o) => !o)} title="Ocena A (operacyjna) i B (autorska) — kliknij, aby zobaczyć punktację">
        <span className={cn("rounded-full px-2 py-0.5 font-semibold", tone(a.total))}>A {a.total}</span>
        <span className={cn("rounded-full px-2 py-0.5 font-semibold", tone(b.total))}>B {b.total}</span>
        {seed != null ? <span className="rounded-full bg-black/[.05] px-2 py-0.5 text-muted" title="Ręczna ocena priorytetu z CSV (nie wynik kampanii)">ręczna {seed}</span> : null}
      </button>
      {open && !compact ? (
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          {[a, b].map((s, i) => (
            <div key={i} className="rounded-lg border border-line p-2">
              <p className="mb-1 font-medium">
                {i === 0 ? "A — operacyjna" : "B — autorska"} <span className="font-normal text-muted">({s.version})</span>
              </p>
              <ul className="space-y-1">
                {s.items.map((it) => (
                  <li key={it.key} className="flex gap-2">
                    <span className="w-12 shrink-0 tabular-nums text-muted">
                      {it.points}/{it.max}
                    </span>
                    <span>
                      {it.label}
                      {it.basis ? <span className="ml-1 text-[10px] uppercase text-muted">[{it.basis}]</span> : null}
                      <span className="block text-muted">{it.why}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function GateList({ gate }: { gate: Gate }) {
  if (!gate.problems.length) return <p className="text-xs text-emerald-700">Brak problemów — gotowe do publikacji.</p>;
  return (
    <ul className="space-y-0.5 text-xs" data-testid="gate-problems">
      {gate.problems.map((p, i) => (
        <li key={i} className={p.level === "blokada" ? "text-red-700" : "text-amber-800"}>
          {p.level === "blokada" ? "⛔" : "⚠"} {p.message}
        </li>
      ))}
    </ul>
  );
}
