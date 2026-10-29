"use client";
/** Small building blocks of Social Media Studio (Linear / Buffer-like: quiet, dense, readable). */
import * as React from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { api, cn } from "@/lib/utils";
import { PLATFORM_META, type Platform } from "@/lib/social/platforms";
import { POST_STATUS, type PostStatus } from "@/lib/social/status";
import { formatInTz } from "@/lib/social/tz";

export function useApi<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(!!url);
  const seq = React.useRef(0);
  const load = React.useCallback(async () => {
    if (!url) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(url, { cache: "no-store" });
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError((e as Error).message);
    } finally {
      if (n === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  React.useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

/** wait for a background job (AI generation, conversion…) */
export async function waitForJob(jobId: string, { timeoutMs = 5 * 60_000, onTick }: { timeoutMs?: number; onTick?: () => void } = {}) {
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    onTick?.();
    const j = await api<{ status: string; error: string | null; result: unknown }>(`/api/social/jobs/${jobId}`);
    if (j.status === "SUCCEEDED") return j.result;
    if (j.status === "FAILED") throw new Error(j.error ?? "Zadanie nie powiodło się");
    if (Date.now() - t0 > timeoutMs) throw new Error("Trwa to dłużej niż zwykle — odśwież stronę za chwilę.");
  }
}

export function PlatformIcon({ platform, size = 20, className }: { platform: Platform | string; size?: number; className?: string }) {
  const m = PLATFORM_META[platform as Platform];
  if (!m) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-white", className)} style={{ width: size, height: size, fontSize: size * 0.42, background: m.color }} title={`${m.name} · ${m.format}`} aria-label={m.name}>
      {m.short}
    </span>
  );
}

const TONES: Record<string, string> = {
  gray: "bg-ink/[.06] text-ink/70",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-300",
  blue: "bg-sky-100 text-sky-900 dark:bg-sky-400/15 dark:text-sky-300",
  green: "bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-300",
  red: "bg-red-100 text-red-800 dark:bg-red-400/15 dark:text-red-300",
  violet: "bg-violet-100 text-violet-900 dark:bg-violet-400/15 dark:text-violet-300",
};

export function Pill({ tone = "gray", children, className, ...rest }: { tone?: keyof typeof TONES; children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium", TONES[tone], className)} {...rest}>
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const s = POST_STATUS[status as PostStatus] ?? { label: status, tone: "gray" as const };
  return (
    <Pill tone={s.tone} data-testid="post-status" data-status={status}>
      {s.label}
    </Pill>
  );
}

export function DemoBadge({ className }: { className?: string }) {
  return (
    <Pill tone="violet" className={cn("font-semibold tracking-wide", className)} title="Dane demonstracyjne — nic nie jest publikowane naprawdę">
      DEMO
    </Pill>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-[22px] font-semibold leading-tight">{title}</h1>
        {subtitle ? <div className="mt-1 text-sm text-muted">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ title, actions, children, className, ...rest }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string } & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  return (
    <section className={cn("rounded-2xl border border-line bg-white", className)} {...rest}>
      {title || actions ? (
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-[13.5px] font-semibold">{title}</h2>
          {actions}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Loading({ label = "Wczytuję…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted" role="status">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">{error}</div>
      {onRetry ? (
        <button className="inline-flex items-center gap-1 text-xs underline" onClick={onRetry}>
          <RefreshCw className="h-3 w-3" /> Spróbuj ponownie
        </button>
      ) : null}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-muted">{icon}</div> : null}
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 max-w-md text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** a metric: null means "the platform does not report it", never 0 */
export function Metric({ value, format = "int", unsupported }: { value: number | null | undefined; format?: "int" | "pct" | "sec"; unsupported?: boolean }) {
  if (value === null || value === undefined)
    return (
      <span className="text-muted/70" title={unsupported ? "Platforma nie udostępnia tej metryki" : "Brak danych"}>
        —
      </span>
    );
  const txt = format === "pct" ? `${(value * 100).toFixed(1).replace(".", ",")}%` : format === "sec" ? `${value.toFixed(1).replace(".", ",")} s` : new Intl.NumberFormat("pl-PL", { notation: value >= 100_000 ? "compact" : "standard" }).format(value);
  return <span className="tabular">{txt}</span>;
}

export function When({ at, tz, opts }: { at: string | null | undefined; tz: string; opts?: Intl.DateTimeFormatOptions }) {
  if (!at) return <span className="text-muted">bez terminu</span>;
  return <span className="tabular">{formatInTz(at, tz, opts ?? { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>;
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: Array<[T, React.ReactNode]>; className?: string }) {
  return (
    <div className={cn("flex gap-1 overflow-x-auto border-b border-line", className)} role="tablist">
      {items.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)} className={cn("-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] transition", value === k ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink")}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Seg<T extends string>({ value, onChange, items, size = "sm" }: { value: T; onChange: (v: T) => void; items: Array<[T, React.ReactNode]>; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-white p-0.5">
      {items.map(([k, label]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)} className={cn("rounded-md px-2.5 transition", size === "sm" ? "py-1 text-[12.5px]" : "py-1.5 text-sm", value === k ? "bg-ink text-white" : "text-muted hover:text-ink")}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, counter, children, error }: { label: React.ReactNode; hint?: React.ReactNode; counter?: { n: number; max?: number }; children: React.ReactNode; error?: string | null }) {
  const over = counter?.max !== undefined && counter.n > counter.max;
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between gap-2 text-[12.5px] font-medium text-ink/80">
        <span>{label}</span>
        {counter ? (
          <span className={cn("tabular text-[11.5px] font-normal", over ? "text-red-600" : "text-muted")}>
            {counter.n}
            {counter.max !== undefined ? ` / ${counter.max}` : ""}
          </span>
        ) : null}
      </span>
      {children}
      {error ? <span className="block text-[12px] text-red-600">{error}</span> : hint ? <span className="block text-[12px] text-muted">{hint}</span> : null}
    </label>
  );
}

export const chars = (s: string) => [...s].length;
