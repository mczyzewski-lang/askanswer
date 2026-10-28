"use client";
import { Loader2, Wand2 } from "lucide-react";
import { Button, Dialog, DialogContent } from "@/components/ui";
import { cn, formatDate } from "@/lib/utils";

/** A script review by the reel editor guidelines (OpenAI) — see src/lib/server/reel-review.ts. */
export interface Review {
  score: number;
  verdict: string;
  diagnosis?: string | null;
  criteria: Array<{ name: string; score: number; why: string }>;
  redFlags: string[];
  levers: string[];
  newVersion: { onScreen: string; timeline: Array<{ time: string; text: string }>; hook: string; body: string; cta: string; shots: string[]; caption: string };
  altHooks: Array<{ mechanism: string; text: string }>;
  predicted: { score: number; limits: string };
  compliance: string[];
  model?: string;
  error?: undefined;
}

export const scoreTone = (n: number) => (n >= 75 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : n >= 50 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-700");

/** The score of one script (or a button to score it). */
export function ScoreBadge({ review: rv, onOpen, onReview, disabled, testid = "ads-score" }: { review: Review | { error: string } | null | undefined; onOpen: () => void; onReview: () => void; disabled: boolean; testid?: string }) {
  if (rv && "score" in rv && typeof rv.score === "number")
    return (
      <button type="button" onClick={onOpen} className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold tabular", scoreTone(rv.score))} data-testid={testid} title={rv.verdict}>
        {rv.score}/100{rv.predicted?.score ? ` → ${rv.predicted.score}` : ""}
      </button>
    );
  if (rv && "error" in rv && rv.error)
    return (
      <button type="button" onClick={onReview} disabled={disabled} className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-700" title={rv.error}>
        błąd · ponów
      </button>
    );
  return (
    <button type="button" onClick={onReview} disabled={disabled} className="rounded-full border border-line px-2 py-0.5 text-xs text-muted hover:text-ink" data-testid={`${testid}-one`}>
      Oceń
    </button>
  );
}

/**
 * The full review of one script (a reel, or a project item read from the prompter): scores, red flags,
 * the version to swap in and the A/B hooks. The caller swaps the text in (`onApply`).
 */
export function ReviewDialog({ title, review, reviewedAt, onClose, onReview, reviewing, onApply }: { title: string; review: Review | { error: string } | null | undefined; reviewedAt: string | null; onClose: () => void; onReview: () => void; reviewing: boolean; onApply: (body: { mode: "all" } | { mode: "hook"; text: string }) => Promise<void> }) {
  const rv = review && "score" in review ? (review as Review) : null;
  const apply = (body: { mode: "all" } | { mode: "hook"; text: string }) => onApply(body);
  const nv = rv?.newVersion;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={title} className="max-w-3xl">
        {!rv ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">{review && "error" in review ? review.error : "Ta treść nie ma jeszcze oceny."}</p>
            <Button onClick={onReview} disabled={reviewing}>
              {reviewing ? <Loader2 className="animate-spin" /> : <Wand2 />} Oceń
            </Button>
          </div>
        ) : (
          <div className="space-y-5 text-sm" data-testid="ads-review">
            <div className="flex flex-wrap items-center gap-3">
              <span className={cn("rounded-xl border px-3 py-1.5 text-lg font-semibold tabular", scoreTone(rv.score))}>{rv.score}/100</span>
              <p className="flex-1">{rv.verdict}</p>
            </div>
            {rv.diagnosis ? <p className="rounded-lg bg-black/[.04] p-2.5 text-xs">{rv.diagnosis}</p> : null}

            <table className="w-full text-left text-xs">
              <tbody>
                {rv.criteria.map((c) => (
                  <tr key={c.name} className="border-t border-line align-top">
                    <td className="py-1.5 pr-2 font-medium">{c.name}</td>
                    <td className="py-1.5 pr-2 tabular">{c.score}/10</td>
                    <td className="py-1.5 text-muted">{c.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-red-700">Czerwone flagi</p>
                {rv.redFlags.length ? (
                  <ul className="list-disc space-y-0.5 pl-4">
                    {rv.redFlags.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted">brak</p>
                )}
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted">3 największe dźwignie</p>
                <ol className="list-decimal space-y-0.5 pl-4">
                  {rv.levers.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ol>
              </div>
            </div>

            {nv ? (
              <div className="space-y-2 rounded-xl border border-line p-3" data-testid="ads-new-version">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">Nowa wersja do podmiany {rv.predicted?.score ? <span className={cn("ml-1 rounded-full border px-2 py-0.5 text-xs", scoreTone(rv.predicted.score))}>przewidywany wynik {rv.predicted.score}/100</span> : null}</p>
                  <Button size="sm" onClick={() => void apply({ mode: "all" })} data-testid="ads-apply-all">
                    Podmień treść
                  </Button>
                </div>
                <p>
                  <span className="text-xs text-muted">Napis na ekranie (0–2 s): </span>
                  <b>{nv.onScreen}</b>
                </p>
                <ul className="space-y-0.5">
                  {nv.timeline.map((t, i) => (
                    <li key={i}>
                      <span className="tabular text-xs text-muted">[{t.time}]</span> {t.text}
                    </li>
                  ))}
                </ul>
                <div className="grid gap-2 text-xs sm:grid-cols-3">
                  {(["hook", "body", "cta"] as const).map((k) => (
                    <div key={k} className="rounded-lg bg-black/[.03] p-2">
                      <p className="mb-0.5 font-semibold uppercase text-muted">{k}</p>
                      <p>{nv[k]}</p>
                    </div>
                  ))}
                </div>
                {nv.shots.length ? (
                  <p className="text-xs">
                    <span className="text-muted">Ujęcia / B-roll: </span>
                    {nv.shots.join(" · ")}
                  </p>
                ) : null}
                <p className="text-xs">
                  <span className="text-muted">Opis pod rolką: </span>
                  {nv.caption}
                </p>
              </div>
            ) : null}

            {rv.altHooks.length ? (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Alternatywne hooki (A/B)</p>
                {rv.altHooks.map((h, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 rounded-lg border border-line p-2">
                    <p>
                      <span className="mr-1 rounded bg-black/[.05] px-1.5 py-0.5 text-[11px]">{h.mechanism}</span>
                      {h.text}
                    </p>
                    <Button size="sm" variant="outline" onClick={() => void apply({ mode: "hook", text: h.text })} data-testid="ads-apply-hook">
                      Użyj
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            {rv.predicted?.limits ? (
              <p className="text-xs">
                <span className="text-muted">Co jeszcze ogranicza wynik: </span>
                {rv.predicted.limits}
              </p>
            ) : null}
            {rv.compliance.length ? (
              <div className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
                <p className="mb-0.5 font-semibold">Uwagi compliance</p>
                <ul className="list-disc pl-4">
                  {rv.compliance.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex justify-between gap-2 border-t border-line pt-3 text-xs text-muted">
              <span>{reviewedAt ? `Oceniono ${formatDate(reviewedAt)}${rv.model ? ` · ${rv.model}` : ""}` : ""}</span>
              <button className="underline hover:text-ink" onClick={onReview} disabled={reviewing}>
                Oceń ponownie
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
