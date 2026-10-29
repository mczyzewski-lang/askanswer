"use client";
import * as React from "react";
import Link from "next/link";
import { BarChart3, ExternalLink, Loader2, Sparkles, Table2 } from "lucide-react";
import { Button } from "@/components/ui";
import { api } from "@/lib/utils";
import { PLATFORM_META, type Platform } from "@/lib/social/platforms";
import { useSocial } from "./shell";
import { Empty, ErrorBox, Loading, Metric, PageHeader, Panel, PlatformIcon, Seg, useApi } from "./ui";

interface Summary {
  published: number;
  measured: number;
  views: number | null;
  reach: number | null;
  interactions: number | null;
  engagementRate: number | null;
}
interface Data {
  days: number;
  current: Summary;
  previous: Summary;
  series: Array<{ day: string; views: number | null }>;
  byPlatform: Array<Summary & { platform: Platform }>;
  top: Array<{ postId: string; contentItemId: string; platform: Platform; title: string; account: string | null; url: string | null; publishedAt: string; views: number | null; likes: number | null; comments: number | null; shares: number | null; engagementRate: number | null }>;
  followers: Array<{ accountId: string; platform: Platform; followers: number | null; change: number | null }>;
  lastUpdated: string | null;
}
interface Insights {
  observations: string[];
  hypotheses: string[];
  topics: string[];
  openings: string[];
  ctas: string[];
  frequency: string;
  hours: string;
  nextVideos: string[];
  caveats: string[];
  sampleSize: number;
  generatedAt: string;
}

function delta(cur: number | null, prev: number | null) {
  if (cur === null || prev === null || prev === 0) return null;
  return (cur - prev) / prev;
}

function Kpi({ label, value, prev, format = "int", hint }: { label: string; value: number | null; prev: number | null; format?: "int" | "pct"; hint?: string }) {
  const d = delta(value, prev);
  return (
    <div className="rounded-2xl border border-line bg-white p-4" title={hint}>
      <p className="text-[12.5px] text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold">
        <Metric value={value} format={format} />
      </p>
      <p className="mt-0.5 text-[11.5px] text-muted">{d === null ? "brak porównania" : `${d >= 0 ? "▲" : "▼"} ${Math.abs(d * 100).toFixed(0)}% vs poprzedni okres`}</p>
    </div>
  );
}

/** single series: views over time — 2px line, light wash, hairline grid, crosshair + tooltip, table view */
function ViewsChart({ series }: { series: Data["series"] }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const [table, setTable] = React.useState(false);
  const W = 720;
  const H = 220;
  const pad = { l: 44, r: 52, t: 12, b: 24 };
  const vals = series.map((s) => s.views);
  const known = vals.filter((v): v is number => v !== null);
  if (!known.length) return <p className="py-10 text-center text-sm text-muted">Brak danych o wyświetleniach w tym okresie.</p>;
  const max = Math.max(...known) * 1.1 || 1;
  const x = (i: number) => pad.l + (i / Math.max(1, series.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const pts = series.map((s, i) => (s.views === null ? null : ([x(i), y(s.views)] as const)));
  const line = pts.reduce((acc, p, i) => (p ? `${acc}${acc && pts[i - 1] ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}` : acc), "");
  const firstIdx = pts.findIndex(Boolean);
  const lastIdx = pts.length - 1 - [...pts].reverse().findIndex(Boolean);
  const area = `${line}L${x(lastIdx).toFixed(1)},${y(0)}L${x(firstIdx).toFixed(1)},${y(0)}Z`;
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const fmt = (n: number) => new Intl.NumberFormat("pl-PL", { notation: n >= 10_000 ? "compact" : "standard" }).format(n);
  const label = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("pl-PL", { day: "numeric", month: "short", timeZone: "UTC" });
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (series.length - 1));
    setHover(Math.max(0, Math.min(series.length - 1, i)));
  };
  const last = series[lastIdx];
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink" onClick={() => setTable((t) => !t)}>
          {table ? <BarChart3 className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />} {table ? "Wykres" : "Tabela"}
        </button>
      </div>
      {table ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1">Dzień</th>
                <th className="py-1 text-right">Wyświetlenia (łącznie)</th>
              </tr>
            </thead>
            <tbody>
              {series.map((s) => (
                <tr key={s.day} className="border-t border-line">
                  <td className="py-1">{label(s.day)}</td>
                  <td className="py-1 text-right">
                    <Metric value={s.views} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Wyświetlenia w czasie">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
                <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)">
                  {fmt(t)}
                </text>
              </g>
            ))}
            {[0, Math.floor((series.length - 1) / 2), series.length - 1].map((i) => (
              <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === series.length - 1 ? "end" : "middle"} fontSize={11} fill="var(--color-muted)">
                {label(series[i].day)}
              </text>
            ))}
            <path d={area} fill="var(--viz-1)" opacity={0.1} />
            <path d={line} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {last?.views !== null && last ? (
              <text x={x(lastIdx) + 6} y={y(last.views!) + 4} fontSize={11.5} fill="var(--color-ink)">
                {fmt(last.views!)}
              </text>
            ) : null}
            {hover !== null ? (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--color-muted)" strokeWidth={1} opacity={0.5} />
                {series[hover].views !== null ? <circle cx={x(hover)} cy={y(series[hover].views!)} r={4} fill="var(--viz-1)" stroke="var(--color-white)" strokeWidth={2} /> : null}
              </g>
            ) : null}
          </svg>
          {hover !== null ? (
            <div className="pointer-events-none absolute top-0 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] shadow-md" style={{ left: `min(calc(${(x(hover) / W) * 100}% + 8px), calc(100% - 140px))` }}>
              <p className="text-muted">{label(series[hover].day)}</p>
              <p className="font-medium">
                <Metric value={series[hover].views} /> wyświetleń
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function Analytics() {
  const { me, projectId, setProjectId, toast } = useSocial();
  const [days, setDays] = React.useState<"7" | "30" | "90">("30");
  const { data, error, loading, reload } = useApi<Data>(projectId ? `/api/social/projects/${projectId}/analytics?days=${days}` : null, [projectId, days]);
  const ins = useApi<{ insights: Insights | null }>(projectId ? `/api/social/projects/${projectId}/insights` : null, [projectId]);
  const [thinking, setThinking] = React.useState(false);
  if (!projectId)
    return (
      <>
        <PageHeader title="Analityka" subtitle="Wybierz projekt." />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {me.projects.map((p) => (
            <button key={p.id} onClick={() => setProjectId(p.id)} className="rounded-xl border border-line bg-white p-4 text-left hover:border-ink/25">
              <p className="font-medium">{p.name}</p>
              <p className="text-[12px] text-muted">{p.organizationName}</p>
            </button>
          ))}
        </div>
      </>
    );
  const maxViews = Math.max(1, ...(data?.byPlatform.map((p) => p.views ?? 0) ?? [1]));
  return (
    <>
      <PageHeader
        title="Analityka"
        subtitle={data?.lastUpdated ? `Dane z ${new Date(data.lastUpdated).toLocaleString("pl-PL")}. „—” = platforma nie podaje tej metryki.` : "Wyniki zbieramy 1 h, 24 h, 72 h, 7 i 30 dni po publikacji."}
        actions={
          <Seg<"7" | "30" | "90">
            value={days}
            onChange={setDays}
            items={[
              ["7", "7 dni"],
              ["30", "30 dni"],
              ["90", "90 dni"],
            ]}
          />
        }
      />
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data && !data.current.published && !data.previous.published ? <Empty icon={<BarChart3 className="h-6 w-6" />} title="Brak opublikowanych filmów w tym okresie" /> : null}
      {data && (data.current.published || data.previous.published) ? (
        <div className="space-y-6" data-testid="analytics">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Kpi label="Opublikowane filmy" value={data.current.published} prev={data.previous.published} />
            <Kpi label="Wyświetlenia" value={data.current.views} prev={data.previous.views} hint="Suma ostatnich znanych wyświetleń publikacji z okresu" />
            <Kpi label="Zasięg" value={data.current.reach} prev={data.previous.reach} hint="Osobna metryka — nie sumujemy jej z wyświetleniami" />
            <Kpi label="Interakcje" value={data.current.interactions} prev={data.previous.interactions} hint="Polubienia + komentarze + udostępnienia + zapisania (tam, gdzie platforma je podaje)" />
            <Kpi label="Śr. zaangażowanie" value={data.current.engagementRate} prev={data.previous.engagementRate} format="pct" />
          </div>
          <Panel title="Wyświetlenia w czasie">
            <ViewsChart series={data.series} />
          </Panel>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Wyniki per platforma">
              <table className="w-full text-[13px]">
                <thead className="text-left text-[12px] text-muted">
                  <tr>
                    <th className="py-1">Platforma</th>
                    <th className="py-1">Filmy</th>
                    <th className="py-1">Wyświetlenia</th>
                    <th className="py-1 text-right">Zaang.</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byPlatform.map((p) => (
                    <tr key={p.platform} className="border-t border-line">
                      <td className="py-2">
                        <span className="inline-flex items-center gap-1.5">
                          <PlatformIcon platform={p.platform} size={16} /> {PLATFORM_META[p.platform].name}
                        </span>
                      </td>
                      <td className="py-2 tabular">{p.published}</td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-r bg-transparent">{p.views !== null ? <div className="h-full rounded-r" style={{ width: `${(p.views / maxViews) * 100}%`, background: "var(--viz-1)" }} /> : null}</div>
                          <span className="w-16 text-right">
                            <Metric value={p.views} />
                          </span>
                        </div>
                      </td>
                      <td className="py-2 text-right">
                        <Metric value={p.engagementRate} format="pct" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.followers.length ? (
                <div className="mt-4 border-t border-line pt-3 text-[12.5px]">
                  <p className="mb-1 font-medium">Obserwujący</p>
                  {data.followers.map((f) => (
                    <p key={f.accountId} className="flex items-center gap-1.5">
                      <PlatformIcon platform={f.platform} size={14} /> <Metric value={f.followers} /> {f.change !== null ? <span className="text-muted">({f.change >= 0 ? "+" : ""}{f.change} w okresie)</span> : <span className="text-muted">(zmiana niedostępna)</span>}
                    </p>
                  ))}
                </div>
              ) : null}
            </Panel>
            <Panel title="Top 10 filmów">
              {data.top.length ? (
                <ol className="space-y-1.5 text-[13px]">
                  {data.top.map((t, i) => (
                    <li key={t.postId} className="flex items-center gap-2">
                      <span className="w-5 text-right tabular text-muted">{i + 1}.</span>
                      <PlatformIcon platform={t.platform} size={16} />
                      <Link href={`/social/content/${t.contentItemId}?post=${t.postId}`} className="min-w-0 flex-1 truncate hover:underline">
                        {t.title}
                      </Link>
                      <span className="text-right">
                        <Metric value={t.views} />
                      </span>
                      {t.url ? (
                        <a href={t.url} target="_blank" rel="noreferrer" className="text-muted hover:text-ink" aria-label="Otwórz publikację">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted">Brak danych o wyświetleniach.</p>
              )}
            </Panel>
          </div>
          <Panel
            title={
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> Wnioski AI
              </span>
            }
            actions={
              <Button
                size="sm"
                variant="outline"
                disabled={thinking}
                onClick={async () => {
                  setThinking(true);
                  try {
                    await api(`/api/social/projects/${projectId}/insights`, { method: "POST" });
                    await ins.reload();
                  } catch (e) {
                    toast((e as Error).message, "err");
                  } finally {
                    setThinking(false);
                  }
                }}
                data-testid="insights"
              >
                {thinking ? <Loader2 className="animate-spin" /> : <Sparkles />} {ins.data?.insights ? "Przeanalizuj ponownie" : "Przeanalizuj wyniki"}
              </Button>
            }
          >
            {ins.data?.insights ? <InsightsView i={ins.data.insights} /> : <p className="text-sm text-muted">AI przeanalizuje historyczne wyniki projektu i zaproponuje tematy, otwarcia, CTA, częstotliwość i godziny do przetestowania.</p>}
          </Panel>
        </div>
      ) : null}
    </>
  );
}

function InsightsView({ i }: { i: Insights }) {
  const list = (title: string, items: string[]) =>
    items.length ? (
      <div>
        <p className="mb-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">{title}</p>
        <ul className="list-disc space-y-0.5 pl-4 text-[13px]">
          {items.map((x, n) => (
            <li key={n}>{x}</li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <div className="space-y-4" data-testid="insights-view">
      {i.sampleSize < 20 ? <p className="rounded-xl bg-amber-50 p-2.5 text-[12.5px] text-amber-900 dark:bg-amber-400/10 dark:text-amber-300">Mała próba ({i.sampleSize} publikacji) — traktuj wnioski jako hipotezy do sprawdzenia.</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {list("Obserwacje (z danych)", i.observations)}
        {list("Hipotezy (do sprawdzenia)", i.hypotheses)}
        {list("Tematy, które działają", i.topics)}
        {list("Otwarcia", i.openings)}
        {list("CTA", i.ctas)}
        {list("Propozycje kolejnych filmów", i.nextVideos)}
      </div>
      {i.frequency || i.hours ? (
        <p className="text-[13px]">
          {i.frequency ? <><b>Częstotliwość:</b> {i.frequency} </> : null}
          {i.hours ? <><b>Godziny (hipoteza):</b> {i.hours}</> : null}
        </p>
      ) : null}
      {list("Zastrzeżenia", i.caveats)}
      <p className="text-[11.5px] text-muted">Wygenerowano {new Date(i.generatedAt).toLocaleString("pl-PL")} na podstawie {i.sampleSize} publikacji.</p>
    </div>
  );
}
