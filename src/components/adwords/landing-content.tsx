"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Copy, Download, Eye, EyeOff, Monitor, Plus, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { Button, Card, Input, Label, NativeSelect, Textarea } from "@/components/ui";
import { api, cn } from "@/lib/utils";
import {
  BASE_VARIANT,
  CLAIM_LABEL,
  CTA_VERSIONS,
  FUNNEL,
  LP_EVENTS,
  LP_VARIANTS,
  OFFER_CORE,
  OFFER_FIELDS,
  SECTION_LABEL,
  SECTIONS,
  STATUS_LABEL,
  URL_STATUS_LABEL,
  adLanding,
  blockFindings,
  blockOf,
  claimsIn,
  isApproved,
  landingScore,
  lpHtml,
  offerMissing,
  offerValid,
  productionBlocks,
  urlStatus,
  validateVariant,
  variantBlocks,
  variantLabel,
  variantsOf,
  type LandingAd,
  type LpBlock,
  type LpContext,
  type LpStatus,
  type OfferInfo,
} from "@/lib/adwords/landing-content";
import { LandingTab } from "./landing";
import type { AwAsset, AwData, Toast } from "./types";

const AD_TYPES = ["image", "video", "headline", "long_headline", "description", "sitelink"];
export const ctxOf = (data: AwData): LpContext => ({ offer: data.landing.offer, claims: data.landing.claims, variants: data.landing.variants, theme: data.theme });
export const blocksOf = (data: AwData) => data.assets.filter((a) => a.rowType === "landing_page").map((a) => blockOf(a));

const StatusChips = ({ statuses }: { statuses: LpStatus[] }) =>
  statuses.length ? (
    <span className="flex flex-wrap gap-1">
      {statuses.map((s) => (
        <span key={s} className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700" title={STATUS_LABEL[s]}>
          {s}
        </span>
      ))}
    </span>
  ) : (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">gotowe do eksportu</span>
  );

/** "Treść Landing Page": the variants of the page the ads lead to — edited as blocks, previewed at 1440 / 390 px */
export function LandingContentTab({ data, reload, toast }: { data: AwData; reload: () => Promise<void>; toast: Toast }) {
  const all = useMemo(() => blocksOf(data), [data]);
  const ids = variantsOf(all);
  const [variant, setVariant] = useState(ids[0] ?? BASE_VARIANT);
  const ctx = ctxOf(data);
  const base = `/api/admin/adwords/${data.project.id}`;
  const ads = data.assets.filter((a) => AD_TYPES.includes(a.rowType)) as unknown as LandingAd[];
  const call = async (url: string, method: string, json?: unknown) => {
    try {
      await api(url, { method, json });
      await reload();
      return true;
    } catch (e) {
      toast((e as Error).message, "err");
      return false;
    }
  };
  return (
    <div className="space-y-4" data-testid="landing-content">
      <Card className="space-y-2 p-5">
        <p className="font-medium">Treść Landing Page</p>
        <p className="text-sm text-muted">
          Warianty strony, na którą prowadzą reklamy — w motywie projektu, powiązane z kreacjami. Sprzedajemy <b>Plan Rozwodu</b>, nie rozmowę z konsultantem: <i>„{OFFER_CORE}”</i>. Twierdzenia bez dowodu i niepotwierdzona oferta blokują eksport produkcyjny (podgląd roboczy pokazuje je z ostrzeżeniem).
        </p>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <OfferCard data={data} call={call} />
        <CtaCard data={data} />
      </div>
      {all.length ? (
        <>
          <div className="flex flex-wrap gap-2" data-testid="lp-variants">
            {ids.map((id) => {
              const bl = variantBlocks(all, id);
              const v = validateVariant(id, bl, ctx);
              const sc = landingScore(bl, ads, ctx, id);
              return (
                <button key={id} type="button" onClick={() => setVariant(id)} className={cn("rounded-xl border px-3 py-2 text-left text-sm", id === variant ? "border-ink bg-white" : "border-line hover:bg-white")} data-testid="lp-variant">
                  <span className="flex items-center gap-2 font-medium">
                    {variantLabel(id)} <span className="rounded bg-black/[.06] px-1.5 text-xs tabular-nums">{sc.total}/100</span>
                  </span>
                  <span className="mt-1 block">
                    <StatusChips statuses={v.statuses} />
                  </span>
                </button>
              );
            })}
          </div>
          <VariantView key={variant} variantId={variant} all={all} data={data} ctx={ctx} ads={ads} call={call} toast={toast} />
        </>
      ) : (
        <Card className="space-y-3 p-5 text-sm">
          <p>Brak bloków landing page. Zaimportuj CSV v5 (wiersze record_scope=landing_content) albo dodaj pierwszy blok wariantu A.</p>
          <Button disabled={!data.canEdit} onClick={() => void call(`${base}/landing/blocks`, "POST", { variantId: BASE_VARIANT, section: "hero", order: 10 })}>
            <Plus /> Dodaj hero wariantu A
          </Button>
        </Card>
      )}
      <ClaimsCard data={data} call={call} />
      <div className="grid gap-4 xl:grid-cols-2">
        <UrlStrategyCard data={data} call={call} />
        <AnalyticsCard />
      </div>
      <details className="rounded-xl border border-line bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium">Ogólne zasady strony docelowej i wzór z reklam (bez treści LP)</summary>
        <div className="mt-4">
          <LandingTab data={data} toast={toast} />
        </div>
      </details>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ offer + CTA

function OfferCard({ data, call }: { data: AwData; call: (u: string, m: string, j?: unknown) => Promise<boolean> }) {
  const [o, setO] = useState<OfferInfo>(data.landing.offer ?? {});
  const ok = offerValid(data.landing.offer);
  const save = (confirmed: boolean) => call(`/api/admin/adwords/${data.project.id}/offer`, "PUT", { ...o, confirmed });
  return (
    <Card className="space-y-3 p-5" data-testid="offer-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Oferta: bezpłatny Plan Rozwodu</p>
        {ok ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" /> potwierdzone — {data.landing.offer?.confirmedBy}
          </span>
        ) : (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700" data-testid="offer-status">
            blocked_offer_validation
          </span>
        )}
      </div>
      <p className="text-xs text-muted">Copywriting nie zastąpi produktu: dopóki plan nie jest faktycznie przekazywany, reklamy i strona nie mogą go obiecywać. Jeśli dziś to tylko bezpłatna konsultacja lub wycena — zostaw niepotwierdzone.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {OFFER_FIELDS.map(([k, label, ph]) => (
          <div key={k} className="space-y-1">
            <Label>{label}</Label>
            <Input value={String(o[k] ?? "")} placeholder={ph} onChange={(e) => setO({ ...o, [k]: e.target.value })} aria-label={label} disabled={!data.canEdit} />
          </div>
        ))}
        <div className="space-y-1 sm:col-span-2">
          <Label>Cena naszej usługi (zakres)</Label>
          <Input value={o.servicePrice ?? ""} placeholder="np. 3 900 zł brutto — przygotowanie dokumentów i prowadzenie do wyroku; bez opłaty sądowej" onChange={(e) => setO({ ...o, servicePrice: e.target.value })} aria-label="Cena naszej usługi" disabled={!data.canEdit} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!data.canEdit} onClick={() => void save(false)}>
          Zapisz opis
        </Button>
        <Button disabled={!data.canEdit || offerMissing(o).length > 0} onClick={() => void save(true)} data-testid="offer-confirm" title={offerMissing(o).length ? `Uzupełnij: ${offerMissing(o).join(", ")}` : ""}>
          <ShieldCheck /> Potwierdzam: plan jest faktycznie dostarczany bezpłatnie
        </Button>
      </div>
    </Card>
  );
}

function CtaCard({ data }: { data: AwData }) {
  const ok = offerValid(data.landing.offer);
  const rows = (Object.keys(CTA_VERSIONS) as Array<keyof typeof CTA_VERSIONS>).map((k) => {
    const v = CTA_VERSIONS[k];
    const bad = claimsIn(v.text).filter((c) => !isApproved(c.key, data.landing.claims));
    const status = k === "user" ? "propozycja — niezatwierdzony claim" : !ok ? "czeka na potwierdzenie oferty" : bad.length ? "twierdzenie bez dowodu" : "do wdrożenia";
    return { k, ...v, status, warn: k === "user" || !ok || bad.length > 0, bad };
  });
  return (
    <Card className="space-y-3 p-5" data-testid="cta-card">
      <p className="font-medium">CTA — wersje i statusy</p>
      {rows.map((r) => (
        <div key={r.k} className="space-y-0.5 rounded-lg border border-line p-3">
          <p className="text-xs text-muted">{r.label}</p>
          <p className="font-medium">„{r.text}”</p>
          <p className={cn("text-xs", r.warn ? "text-amber-800" : "text-emerald-700")}>
            {r.status}
            {r.bad.some((c) => c.key === "total_divorce_cost") ? " · „całkowity koszt rozwodu” obejmuje dla klienta też opłaty sądowe i koszty osób trzecich — gwarantujemy tylko cenę naszej usługi" : ""}
          </p>
        </div>
      ))}
      <p className="text-xs text-muted">Na grafikach i w filmach krótsze: „Odbierz bezpłatny plan” / „Poznaj koszt i odbierz plan” — zawsze prowadzące do prawdziwego kroku otrzymania planu. Długie CTA zapisuj w treści LP, nie w nagłówkach PMax (30 znaków).</p>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------ variant

function VariantView({ variantId, all, data, ctx, ads, call, toast }: { variantId: string; all: LpBlock[]; data: AwData; ctx: LpContext; ads: LandingAd[]; call: (u: string, m: string, j?: unknown) => Promise<boolean>; toast: Toast }) {
  const blocks = variantBlocks(all, variantId);
  const v = validateVariant(variantId, blocks, ctx);
  const score = landingScore(blocks, ads, ctx, variantId);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [mode, setMode] = useState<"preview" | "production">("preview");
  const [url, setUrl] = useState(ctx.variants[variantId]?.url ?? "");
  const [newSection, setNewSection] = useState<string>("faq");
  const base = `/api/admin/adwords/${data.project.id}`;
  const linked = ads.filter((a) => a.landingVariantId === variantId);
  const exportBlocked = v.statuses.some((s) => s !== "blocked_claim_validation");
  const exp = (fmt: string, m = mode) => `${base}/landing/export?variant=${variantId}&fmt=${fmt}&mode=${m}`;
  return (
    <div className="space-y-4" data-testid="lp-variant-view">
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-display text-lg font-semibold">{variantLabel(variantId)}</p>
            <p className="text-sm text-muted">{LP_VARIANTS[variantId]?.note ?? ""}</p>
          </div>
          <StatusChips statuses={v.statuses} />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1 space-y-1">
            <Label>Adres wariantu (final URL)</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="URL wariantu" disabled={!data.canEdit} />
          </div>
          <Button variant="outline" disabled={!data.canEdit} onClick={() => void call(`${base}/landing`, "PATCH", { variant: { id: variantId, url: url || null } })} data-testid="lp-url-save">
            Zapisz URL
          </Button>
          <span data-testid="lp-url-status" className={cn("pb-2 text-xs", urlStatus(ctx.variants[variantId]?.url) === "ok" ? "text-emerald-700" : "text-red-700")}>{URL_STATUS_LABEL[urlStatus(ctx.variants[variantId]?.url)]}</span>
        </div>
      </Card>
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-2" data-testid="lp-blocks">
          {blocks.map((b) => (
            <BlockEditor key={`${b.id}-${JSON.stringify(b)}`} b={b} variantId={variantId} data={data} ctx={ctx} call={call} />
          ))}
          <div className="flex flex-wrap gap-2 rounded-xl border border-dashed border-line p-3">
            <NativeSelect className="h-9 w-56" value={newSection} onChange={(e) => setNewSection(e.target.value)} aria-label="Nowy blok">
              {SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {SECTION_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
            <Button variant="outline" disabled={!data.canEdit} onClick={() => void call(`${base}/landing/blocks`, "POST", { variantId, section: newSection, order: Math.max(0, ...blocks.map((x) => x.order)) + 10 })}>
              <Plus /> Dodaj blok
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-line p-0.5">
              {(["desktop", "mobile"] as const).map((d) => (
                <button key={d} type="button" onClick={() => setDevice(d)} className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs", device === d ? "bg-ink text-white" : "text-muted hover:text-ink")} aria-pressed={device === d}>
                  {d === "mobile" ? <Smartphone className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />} {d === "mobile" ? "390 px" : "1440 px"}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg border border-line p-0.5">
              {(["preview", "production"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} className={cn("h-8 rounded-md px-2.5 text-xs", mode === m ? "bg-ink text-white" : "text-muted hover:text-ink")} aria-pressed={mode === m} data-testid={`lp-mode-${m}`}>
                  {m === "preview" ? "Podgląd roboczy (z ostrzeżeniami)" : "Produkcyjny (bez niepotwierdzonych)"}
                </button>
              ))}
            </div>
          </div>
          <LandingPreview blocks={blocks} variantId={variantId} data={data} ctx={ctx} device={device} mode={mode} />
          <div className="flex flex-wrap gap-2" data-testid="lp-exports">
            {(["html", "md", "json", "csv"] as const).map((f) => (
              <a key={f} href={exp(f)} className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs hover:bg-black/[.03]", mode === "production" && exportBlocked && "pointer-events-none opacity-40")} data-testid={`lp-export-${f}`} aria-disabled={mode === "production" && exportBlocked}>
                <Download className="h-3.5 w-3.5" /> {f.toUpperCase()}
              </a>
            ))}
            <span className="self-center text-xs text-muted">{mode === "production" ? (exportBlocked ? "Eksport produkcyjny zablokowany: " + v.statuses.filter((s) => s !== "blocked_claim_validation").map((s) => STATUS_LABEL[s]).join(", ") : "Eksport produkcyjny: niepotwierdzone twierdzenia usunięte.") : "Podgląd roboczy — oznaczony, nie do publikacji."}</span>
          </div>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="space-y-2 p-4" data-testid="lp-checks">
          <p className="text-sm font-medium">Walidator</p>
          <ul className="space-y-1 text-sm">
            {v.checks.map((c, i) => (
              <li key={i} className={c.level === "blokada" ? "text-red-700" : c.level === "do_poprawy" ? "text-amber-800" : c.level === "ok" ? "text-emerald-700" : "text-muted"}>
                {c.level === "ok" ? "✓" : c.level === "blokada" ? "⛔" : c.level === "do_poprawy" ? "⚠" : "ℹ"} {c.message}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="space-y-2 p-4" data-testid="lp-score">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium">Landing Match Score</p>
            <p className="font-display text-2xl font-semibold tabular-nums">{score.total}/100</p>
          </div>
          <p className="text-xs text-muted">Heurystyka do audytu — nie prognoza CVR. Oddzielna od score_seed reklam i od wyników kampanii (CPL kwalifikowany, CAC, sprzedaż). Blokady są ważniejsze niż wynik.</p>
          <table className="w-full text-sm">
            <tbody>
              {score.parts.map((p) => (
                <tr key={p.key} className="border-b border-line/60 align-top">
                  <td className="py-1 pr-2">{p.label}</td>
                  <td className="w-16 py-1 text-right tabular-nums">
                    {p.points}/{p.max}
                  </td>
                  <td className="py-1 pl-3 text-xs text-muted">{p.notes.join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <Card className="space-y-2 p-4" data-testid="lp-linked-ads">
        <p className="text-sm font-medium">Reklamy prowadzące na ten wariant ({linked.length})</p>
        {linked.length ? <LinkedAdsTable ads={linked} all={all} ctx={ctx} /> : <p className="text-sm text-muted">Żadna kreacja nie ma landing_variant_id = {variantId}.</p>}
        <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(lpHtml(blocks, { projectName: data.project.name, variantId, url: null, mode: "production", statuses: [] }, { theme: data.theme })).then(() => toast("Skopiowano HTML (bez filtrowania — do porównania)"))}>
          <Copy /> Kopiuj surowy HTML
        </Button>
      </Card>
    </div>
  );
}

function LinkedAdsTable({ ads, all, ctx }: { ads: LandingAd[]; all: LpBlock[]; ctx: LpContext }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted">
          <tr>
            <th className="py-1 pr-2">Asset</th>
            <th className="pr-2">Treść</th>
            <th className="pr-2">Angle</th>
            <th className="pr-2">CTA</th>
            <th className="pr-2">URL</th>
            <th>Message match</th>
          </tr>
        </thead>
        <tbody>
          {ads.map((a) => {
            const l = adLanding(a, all, ctx);
            return (
              <tr key={a.id} className="border-t border-line/60 align-top" data-testid="lp-ad-row">
                <td className="py-1 pr-2 font-mono text-xs">{a.assetKey}</td>
                <td className="pr-2">{a.headline || a.adText || a.screenText}</td>
                <td className="pr-2 text-xs">{a.lp?.message_match_angle ?? "—"}</td>
                <td className="pr-2 text-xs">{a.cta ?? a.lp?.cta_button_short ?? "—"}</td>
                <td className={cn("pr-2 text-xs", l.urlStatus === "ok" ? "text-emerald-700" : "text-red-700")}>{URL_STATUS_LABEL[l.urlStatus]}</td>
                <td className="text-xs">
                  {l.match ? (
                    <span title={l.match.notes.join(" ")} className={l.match.label === "dobra" ? "text-emerald-700" : l.match.label === "częściowa" ? "text-amber-800" : "text-red-700"}>
                      {l.match.score}/100 · {l.match.label}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ preview

/** the export HTML itself in an iframe, at the real width (1440 / 390 px) scaled to the column */
function LandingPreview({ blocks, variantId, data, ctx, device, mode }: { blocks: LpBlock[]; variantId: string; data: AwData; ctx: LpContext; device: "desktop" | "mobile"; mode: "preview" | "production" }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const W = device === "desktop" ? 1440 : 390;
  const H = device === "desktop" ? 900 : 844;
  const scale = Math.min(1, w / W);
  const v = validateVariant(variantId, blocks, ctx);
  const shown = mode === "production" ? productionBlocks(blocks, ctx) : { blocks: blocks.filter((b) => !b.hidden), removed: [] };
  const photo = (id: string | null) => {
    const p = id ? data.photos.find((x) => x.id === id) : null;
    return p?.consentConfirmed ? p.url : null;
  };
  const html = lpHtml(shown.blocks, { projectName: data.project.name, variantId, url: ctx.variants[variantId]?.url ?? null, mode, statuses: mode === "preview" ? v.statuses : [], removed: shown.removed }, { theme: data.theme, logoUrl: data.logoUrl, photoUrl: photo, fontBase: typeof window !== "undefined" ? window.location.origin : null, findings: (b) => blockFindings(b, ctx), businessName: data.campaigns.find((c) => c.businessName)?.businessName ?? data.project.name });
  return (
    <div ref={box} className="w-full">
      <div className={cn("mx-auto overflow-hidden rounded-xl border border-line bg-white shadow-sm", device === "mobile" && "rounded-[22px] border-4 border-ink/80")} style={{ width: W * scale, height: H * scale }}>
        <iframe title={`Podgląd ${variantId} ${W}px`} srcDoc={html} sandbox="allow-same-origin" style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: "0 0", border: 0 }} data-testid="lp-preview" />
      </div>
      {mode === "production" && shown.removed.length ? (
        <p className="mt-1 text-xs text-amber-800" data-testid="lp-removed">
          Usunięte z wersji produkcyjnej: {shown.removed.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------ block editor

const FIELDS: Array<[string, string, "input" | "area"]> = [
  ["landing_eyebrow", "Eyebrow", "input"],
  ["landing_social_proof", "Social proof (ocena, opinie)", "input"],
  ["landing_h1", "H1 (tylko hero)", "input"],
  ["landing_h2", "H2 / podtytuł", "area"],
  ["body", "Treść", "area"],
  ["landing_bullets", "Punkty / pola / pytania (rozdziel |)", "area"],
  ["comparison_left", "Porównanie — tradycyjnie", "area"],
  ["comparison_right", "Porównanie — Nowy Etap", "area"],
  ["landing_primary_cta", "Główne CTA", "input"],
  ["landing_secondary_cta", "Drugie CTA", "input"],
  ["landing_microcopy", "Mikrocopy pod CTA", "input"],
  ["landing_visual_direction", "Kierunek wizualny", "input"],
  ["landing_event", "Zdarzenie analityki", "input"],
];
const valueOf = (b: LpBlock, k: string) =>
  ({ landing_eyebrow: b.eyebrow, landing_social_proof: b.socialProof, landing_h1: b.h1, landing_h2: b.h2, body: b.body, landing_bullets: b.bullets.join(" | "), comparison_left: b.comparisonLeft, comparison_right: b.comparisonRight, landing_primary_cta: b.primaryCta, landing_secondary_cta: b.secondaryCta, landing_microcopy: b.microcopy, landing_visual_direction: b.visual, landing_event: b.event })[k] ?? "";
const relevant = (section: string, k: string, b: LpBlock) =>
  !!valueOf(b, k) ||
  ({ hero: ["landing_eyebrow", "landing_social_proof", "landing_h1", "landing_h2", "landing_primary_cta", "landing_microcopy", "landing_visual_direction", "landing_event"], comparison: ["landing_h2", "comparison_left", "comparison_right"], form: ["landing_h2", "landing_bullets", "landing_primary_cta", "landing_microcopy", "landing_event"], faq: ["landing_h2", "landing_bullets"], sticky_cta: ["landing_primary_cta", "landing_event"] } as Record<string, string[]>)[section]?.includes(k) ||
  (!["hero", "comparison", "form", "faq", "sticky_cta"].includes(section) && ["landing_h2", "body", "landing_bullets"].includes(k));

function BlockEditor({ b, variantId, data, ctx, call }: { b: LpBlock; variantId: string; data: AwData; ctx: LpContext; call: (u: string, m: string, j?: unknown) => Promise<boolean> }) {
  const [open, setOpen] = useState(b.section === "hero" && !b.inherited);
  const [all, setAll] = useState(false);
  const f = blockFindings(b, ctx);
  const url = `/api/admin/adwords/${data.project.id}/landing/blocks/${b.id}`;
  const patch = (j: Record<string, unknown>) => call(url, "PATCH", j);
  const save = (k: string, val: string) => {
    if (val === valueOf(b, k)) return;
    void patch({ [k]: val });
  };
  return (
    <div className={cn("rounded-xl border bg-white", f.statuses.length ? "border-red-300" : "border-line", b.hidden && "opacity-60")} data-testid="lp-block">
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm">
          {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
          <span className="w-8 shrink-0 text-xs tabular-nums text-muted">{b.order}</span>
          <span className="font-medium">{SECTION_LABEL[b.section] ?? b.section}</span>
          <span className="truncate text-muted">{b.h1 || b.h2 || b.primaryCta}</span>
        </button>
        {b.inherited ? <span className="shrink-0 rounded bg-sky-50 px-1.5 text-[11px] text-sky-800">z wariantu A</span> : null}
        {f.statuses.length ? <span className="shrink-0 rounded bg-red-50 px-1.5 text-[11px] text-red-700">{f.statuses.join(", ")}</span> : null}
      </div>
      {open ? (
        <div className="space-y-2 border-t border-line px-3 py-3">
          {b.inherited ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">
              Blok dziedziczony z wariantu A — zmiany tutaj zmienią też A.
              <Button size="sm" variant="outline" disabled={!data.canEdit} onClick={() => void call(`/api/admin/adwords/${data.project.id}/landing/blocks`, "POST", { variantId, section: b.section, copyOf: b.id, order: b.order })}>
                Nadpisz w tym wariancie
              </Button>
            </div>
          ) : null}
          {f.claims.length ? (
            <ul className="text-xs">
              {f.claims.map((c) => (
                <li key={c.key} className={c.approved ? "text-emerald-700" : "text-red-700"}>
                  {c.approved ? "✓" : "⛔"} {c.label}: „{c.match}” {c.approved ? "— potwierdzone" : "— brak dowodu w rejestrze"}
                </li>
              ))}
            </ul>
          ) : null}
          {b.proofSourceRequired ? <p className="text-xs text-muted">Wymagany dowód: {b.proofSourceRequired}</p> : null}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Sekcja</Label>
              <NativeSelect value={b.section} onChange={(e) => void patch({ landing_section: e.target.value })} aria-label="Sekcja bloku" disabled={!data.canEdit}>
                {SECTIONS.map((s) => (
                  <option key={s} value={s}>
                    {SECTION_LABEL[s]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label>Kolejność</Label>
              <Input type="number" defaultValue={b.order} onBlur={(e) => Number(e.target.value) !== b.order && void patch({ landing_order: Math.max(0, Math.round(Number(e.target.value) || 0)) })} aria-label="Kolejność bloku" disabled={!data.canEdit} />
            </div>
          </div>
          {FIELDS.filter(([k]) => all || relevant(b.section, k, b)).map(([k, label, kind]) => (
            <div key={k} className="space-y-1">
              <Label>{label}</Label>
              {kind === "area" ? (
                <Textarea rows={2} defaultValue={valueOf(b, k)} onBlur={(e) => save(k, e.target.value)} aria-label={`${label} — ${b.section}`} disabled={!data.canEdit} />
              ) : (
                <Input defaultValue={valueOf(b, k)} onBlur={(e) => save(k, e.target.value)} aria-label={`${label} — ${b.section}`} disabled={!data.canEdit} />
              )}
            </div>
          ))}
          <button type="button" className="text-xs text-muted underline" onClick={() => setAll(!all)}>
            {all ? "Pokaż tylko pola tej sekcji" : "Pokaż wszystkie pola"}
          </button>
          {["hero", "expert_video", "case_study"].includes(b.section) ? (
            <div className="space-y-1">
              <Label>Zdjęcie (biblioteka ekspertów, tylko ze zgodą)</Label>
              <NativeSelect value={b.photoId ?? ""} onChange={(e) => void patch({ photoId: e.target.value || null })} aria-label="Zdjęcie bloku" disabled={!data.canEdit}>
                <option value="">— brak —</option>
                {data.photos.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.consentConfirmed}>
                    {p.name}
                    {p.consentConfirmed ? "" : " (brak zgody)"}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" disabled={!data.canEdit} onClick={() => void patch({ hidden: !b.hidden })}>
              {b.hidden ? <Eye /> : <EyeOff />} {b.hidden ? "Pokaż" : "Ukryj"}
            </Button>
            {!b.inherited ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={!data.canEdit}
                onClick={() => {
                  if (confirm("Usunąć blok?")) void call(`/api/admin/adwords/${data.project.id}/landing/blocks/${b.id}`, "DELETE");
                }}
              >
                <Trash2 /> Usuń
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------ claims

function ClaimsCard({ data, call }: { data: AwData; call: (u: string, m: string, j?: unknown) => Promise<boolean> }) {
  const base = `/api/admin/adwords/${data.project.id}/claims`;
  const [text, setText] = useState("");
  return (
    <Card className="space-y-3 p-5" data-testid="claims-card">
      <div>
        <p className="font-medium">Rejestr twierdzeń (claims registry)</p>
        <p className="text-xs text-muted">Każda liczba, ocena, rekord czy sygnatura z reklam i strony trafia tu automatycznie. Bez źródła i daty sprawdzenia twierdzenie jest blokowane w reklamach i usuwane z produkcyjnego renderu strony. „5205 osób” to nie to samo co „2600 rozwodów”.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-1 pr-2">Twierdzenie</th>
              <th className="pr-2">Zakres (claim_scope)</th>
              <th className="pr-2">Źródło dowodu</th>
              <th className="pr-2">Data sprawdzenia</th>
              <th className="pr-2">Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.landing.claims.map((c) => (
              <tr key={`${c.id}-${c.approvalStatus}-${c.proofSource}-${c.dateChecked}`} className="border-t border-line/60 align-top" data-testid="claim-row">
                <td className="py-1.5 pr-2">
                  <span className="block font-medium">{c.claimText}</span>
                  <span className="text-[11px] text-muted">{CLAIM_LABEL[c.key] ? c.key : ""}{c.note ? ` · wymagane: ${c.note}` : ""}</span>
                </td>
                <td className="pr-2">
                  <Input className="h-8 text-xs" defaultValue={c.claimScope ?? ""} onBlur={(e) => e.target.value !== (c.claimScope ?? "") && void call(`${base}/${c.id}`, "PATCH", { claimScope: e.target.value })} aria-label={`Zakres ${c.key}`} disabled={!data.canEdit} />
                </td>
                <td className="pr-2">
                  <Input className="h-8 text-xs" defaultValue={c.proofSource ?? ""} placeholder="np. profil Google, zrzut z dnia…" onBlur={(e) => e.target.value !== (c.proofSource ?? "") && void call(`${base}/${c.id}`, "PATCH", { proofSource: e.target.value })} aria-label={`Źródło ${c.key}`} disabled={!data.canEdit} />
                </td>
                <td className="pr-2">
                  <Input type="date" className="h-8 text-xs" defaultValue={c.dateChecked ? String(c.dateChecked).slice(0, 10) : ""} onBlur={(e) => e.target.value !== (c.dateChecked ? String(c.dateChecked).slice(0, 10) : "") && void call(`${base}/${c.id}`, "PATCH", { dateChecked: e.target.value || null })} aria-label={`Data ${c.key}`} disabled={!data.canEdit} />
                </td>
                <td className={cn("pr-2 text-xs", c.approvalStatus === "approved" ? "text-emerald-700" : c.approvalStatus === "rejected" ? "text-red-700" : "text-amber-800")}>
                  {c.approvalStatus === "approved" ? `zatwierdzone — ${c.approvedBy}` : c.approvalStatus === "rejected" ? "odrzucone" : "czeka na dowód"}
                </td>
                <td className="whitespace-nowrap">
                  {c.approvalStatus !== "approved" ? (
                    <Button size="sm" variant="outline" disabled={!data.canEdit || !c.proofSource || !c.dateChecked} title={!c.proofSource || !c.dateChecked ? "Najpierw źródło i data" : ""} onClick={() => void call(`${base}/${c.id}`, "PATCH", { approvalStatus: "approved" })} data-testid="claim-approve">
                      Zatwierdź
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={!data.canEdit} onClick={() => void call(`${base}/${c.id}`, "PATCH", { approvalStatus: "pending" })}>
                      Cofnij
                    </Button>
                  )}
                  {c.approvalStatus !== "rejected" ? (
                    <Button size="sm" variant="ghost" disabled={!data.canEdit} onClick={() => void call(`${base}/${c.id}`, "PATCH", { approvalStatus: "rejected" })}>
                      Odrzuć
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="h-9 max-w-md" value={text} onChange={(e) => setText(e.target.value)} placeholder="Dodaj twierdzenie ręcznie…" aria-label="Nowe twierdzenie" disabled={!data.canEdit} />
        <Button variant="outline" disabled={!data.canEdit || text.trim().length < 2} onClick={() => void call(base, "POST", { claimText: text }).then((ok) => ok && setText(""))}>
          <Plus /> Dodaj
        </Button>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------ URL strategy + analytics

function UrlStrategyCard({ data, call }: { data: AwData; call: (u: string, m: string, j?: unknown) => Promise<boolean> }) {
  const s = data.landing.settings.urlStrategy;
  const [fue, setFue] = useState<"on" | "off" | "unknown">(s?.finalUrlExpansion ?? "unknown");
  const [ex, setEx] = useState(s?.exclusions ?? "");
  const sitelinks = data.assets.filter((a) => a.rowType === "sitelink");
  const adUrls = [...new Set(data.assets.filter((a) => AD_TYPES.includes(a.rowType)).map((a) => a.landingUrl).filter(Boolean))];
  return (
    <Card className="space-y-3 p-5" data-testid="url-strategy">
      <p className="font-medium">Strategia URL — Final URL expansion</p>
      <p className="text-xs text-muted">
        W PMax rozszerzanie końcowego URL jest domyślnie włączone: Google może kierować ruch na inne strony domeny niż wskazany LP. Agencja musi świadomie wybrać: wyłączyć je, albo zostawić z wykluczeniami URL — i sprawdzić w raportach rzeczywiste strony docelowe. Nie obiecujemy programowej kontroli nad emisją komponentów i sitelinków.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label>Final URL expansion</Label>
          <NativeSelect className="h-9 w-52" value={fue} onChange={(e) => setFue(e.target.value as "on" | "off" | "unknown")} aria-label="Final URL expansion" disabled={!data.canEdit}>
            <option value="unknown">nie ustalono</option>
            <option value="off">wyłączone</option>
            <option value="on">włączone (z wykluczeniami)</option>
          </NativeSelect>
        </div>
        <div className="min-w-56 flex-1 space-y-1">
          <Label>Wykluczenia URL (jedno na linię)</Label>
          <Textarea rows={2} value={ex} onChange={(e) => setEx(e.target.value)} aria-label="Wykluczenia URL" disabled={!data.canEdit} placeholder="/blog/&#10;/kariera/" />
        </div>
        <Button variant="outline" disabled={!data.canEdit} onClick={() => void call(`/api/admin/adwords/${data.project.id}/landing`, "PATCH", { urlStrategy: { finalUrlExpansion: fue, exclusions: ex } })}>
          Zapisz
        </Button>
      </div>
      <ul className="space-y-0.5 text-xs">
        {fue === "unknown" ? <li className="text-amber-800">⚠ Strategia URL nieustalona — zapisz decyzję agencji.</li> : <li className="text-emerald-700">✓ Ustalono: {fue === "off" ? "wyłączone" : "włączone z wykluczeniami"}{s?.checkedBy ? ` (${s.checkedBy})` : ""}</li>}
        {fue === "on" && !ex.trim() ? <li className="text-amber-800">⚠ Włączone bez wykluczeń — ruch może trafić np. na bloga zamiast na LP planu.</li> : null}
        <li className="text-muted">Adresy w reklamach: {adUrls.length ? adUrls.join(", ") : "brak"}</li>
        {sitelinks.map((x) => (
          <li key={x.id} className={urlStatus(x.landingUrl) === "ok" ? "text-muted" : "text-red-700"}>
            Sitelink {x.assetKey} „{x.adText}”: {urlStatus(x.landingUrl) === "ok" ? x.landingUrl : URL_STATUS_LABEL[urlStatus(x.landingUrl)]}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AnalyticsCard() {
  return (
    <Card className="space-y-3 p-5" data-testid="lp-analytics">
      <p className="font-medium">Analityka i lejek</p>
      <p className="flex flex-wrap items-center gap-1 text-xs">
        {FUNNEL.map((f, i) => (
          <span key={f} className="flex items-center gap-1">
            <span className="rounded bg-black/[.05] px-1.5 py-0.5">{f}</span>
            {i < FUNNEL.length - 1 ? "→" : ""}
          </span>
        ))}
      </p>
      <table className="w-full text-left text-sm">
        <tbody>
          {LP_EVENTS.map((e) => (
            <tr key={e.name} className="border-b border-line/60">
              <td className="py-1 pr-3 font-mono text-xs">{e.name}</td>
              <td className="py-1 text-xs text-muted">{e.when}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted">
        KPI: liczba klientów i koszt pozyskania klienta (CAC); pomocniczo: realnie dostarczone plany, odsetek kwalifikowanych leadów, konwersja po 30/60/90 dniach. Do platform reklamowych nie wysyłaj treści sprawy ani wrażliwych odpowiedzi z formularza. Rozwód to kategoria wrażliwa (relationship hardships) — przed Customer Match, remarketingiem i enhanced conversions sprawdź zasady dla konkretnych danych. Wynik sitelinka (np. 8% przy „Kontakt”) dotyczy całej reklamy, nie samego linku.
      </p>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------ ads ↔ landing (used in the ad editors)

/** where the ad leads: variant, angle, CTA, URL status, message match */
export function AdLandingInfo({ data, asset, compact }: { data: AwData; asset: AwAsset; compact?: boolean }) {
  const all = blocksOf(data);
  if (!all.length && !asset.landingVariantId && !asset.lp) return null;
  const l = adLanding(asset as unknown as LandingAd, all, ctxOf(data));
  const tone = l.match ? (l.match.label === "dobra" ? "text-emerald-700" : l.match.label === "częściowa" ? "text-amber-800" : "text-red-700") : "text-red-700";
  if (compact)
    return (
      <span className={cn("shrink-0 text-[11px]", l.variantId ? tone : "text-muted")} title={l.match?.notes.join(" ") ?? l.note ?? ""} data-testid="ad-landing-compact">
        {l.variantId ? `${variantLabel(l.variantId)} · ${l.match ? `${l.match.score}` : "—"}` : "bez LP"}
      </span>
    );
  return (
    <div className="space-y-0.5 rounded-lg border border-line px-3 py-2 text-xs" data-testid="ad-landing">
      <p className="font-medium">Docelowy landing page: {l.variantId ? variantLabel(l.variantId) : <span className="text-red-700">brak produkcyjnego LP</span>}</p>
      {l.note ? <p className="text-muted">{l.note}</p> : null}
      <p>
        Angle: {asset.lp?.message_match_angle ?? "—"} · CTA: {asset.cta ?? asset.lp?.cta_button_short ?? "—"} · <span className={l.urlStatus === "ok" ? "text-emerald-700" : "text-red-700"}>{URL_STATUS_LABEL[l.urlStatus]}</span>
      </p>
      {l.match ? (
        <p className={tone}>
          Message match: {l.match.score}/100 ({l.match.label}){l.match.notes.length ? ` — ${l.match.notes.join(" ")}` : ""}
        </p>
      ) : null}
      {l.statuses.length ? <p className="text-red-700">Status: {l.statuses.join(", ")}</p> : null}
    </div>
  );
}
