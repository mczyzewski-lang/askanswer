"use client";
import { useState } from "react";
import { Check, Copy, Download, Package } from "lucide-react";

export type ShareStatus = "gotowe" | "do_poprawy" | "blokada";
export interface ShareData {
  token: string;
  project: string;
  label: string;
  expiresAt: string | null;
  specVerifiedAt: string;
  campaigns: Array<{ code: string; name: string; url: string | null; businessName: string | null }>;
  concepts: Array<{ conceptId: string; headline: string; subheadline: string; cta: string; clean: boolean; experiment: string | null; landing: string | null; status: ShareStatus; problems: string[]; images: Array<{ id: string; format: string; key: string; size: string; status: ShareStatus }> }>;
  texts: Array<{ kind: string; label: string; max: number; items: Array<{ id: string; assetKey: string; text: string; len: number; status: ShareStatus; problems: string[] }> }>;
  sitelinks: Array<{ id: string; assetKey: string; text: string; d1: string; d2: string; url: string; status: ShareStatus; problems: string[] }>;
  videos: Array<{ conceptId: string; headline: string; formats: string[]; status: ShareStatus; problems: string[]; scenes: Array<{ t: string; spoken: string; screen: string; visual: string }> }>;
  landing: Array<{ id: string; label: string; url: string | null; exportable: boolean; reasons: string[]; claimsRemoved: boolean }>;
  brief: string;
}

const TONE: Record<ShareStatus, string> = { gotowe: "bg-emerald-50 text-emerald-700", do_poprawy: "bg-amber-50 text-amber-800", blokada: "bg-red-50 text-red-700" };
const LABEL: Record<ShareStatus, string> = { gotowe: "gotowe", do_poprawy: "do sprawdzenia", blokada: "zablokowane — nie publikować" };
const Badge = ({ s }: { s: ShareStatus }) => <span className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[s]}`}>{LABEL[s]}</span>;
const btn = "inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 text-sm hover:bg-black/[.03]";
const btnDark = "inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#111] px-3 text-sm font-medium text-white hover:bg-black/80";

function CopyBtn({ text, label = "Kopiuj" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-black/10 px-2 text-xs hover:bg-black/[.03]"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        })
      }
      aria-label={`${label}: ${text.slice(0, 40)}`}
    >
      {ok ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {ok ? "Skopiowano" : label}
    </button>
  );
}

/** what the agency sees: previews, texts to copy, scripts, landing pages and the packages to download — nothing editable */
export function AdwordsShareView({ data }: { data: ShareData }) {
  const base = `/api/share/adwords/${data.token}`;
  const sections = [
    ["grafiki", `Grafiki (${data.concepts.length})`],
    ["teksty", "Teksty"],
    ...(data.sitelinks.length ? [["sitelinki", "Sitelinki"]] : []),
    ...(data.videos.length ? [["wideo", `Wideo (${data.videos.length})`]] : []),
    ...(data.landing.length ? [["landing", "Landing page"]] : []),
    ["brief", "Brief"],
  ];
  const ready = <T extends { status: ShareStatus }>(xs: T[]) => xs.filter((x) => x.status !== "blokada");
  return (
    <div className="min-h-screen bg-[#f6f5f2] text-[#111]" data-testid="share-view">
      <header className="border-b border-black/10 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-5">
          <p className="text-xs uppercase tracking-wide text-black/50">Materiały Google Ads · Performance Max · podgląd dla agencji</p>
          <h1 className="mt-1 text-2xl font-semibold">{data.project}</h1>
          <p className="mt-1 text-sm text-black/60">
            {data.label} · tylko do odczytu{data.expiresAt ? ` · link ważny do ${new Date(data.expiresAt).toLocaleDateString("pl-PL")}` : ""} · specyfikacja PMax z {data.specVerifiedAt}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a className={btnDark} href={`${base}/zip?fmt=png`} data-testid="share-zip">
              <Package className="h-4 w-4" /> Pobierz wszystko gotowe (PNG)
            </a>
            <a className={btn} href={`${base}/zip?fmt=jpg`}>
              JPG
            </a>
            <a className={btn} href={`${base}/zip?parts=images`}>
              Tylko grafiki
            </a>
            <a className={btn} href={`${base}/zip?parts=texts`} data-testid="share-zip-texts">
              Tylko teksty (CSV)
            </a>
            {data.videos.length ? (
              <a className={btn} href={`${base}/zip?parts=videos`}>
                Wideo: skrypty, napisy, shot lista
              </a>
            ) : null}
            {data.landing.length ? (
              <a className={btn} href={`${base}/zip?parts=landing`}>
                Landing page
              </a>
            ) : null}
          </div>
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Paczki zawierają tylko komponenty, które przeszły kontrolę. Pozycje oznaczone „zablokowane — nie publikować” są widoczne dla kontekstu, ale nie do pobrania i nie do wgrania do Google Ads. „Do sprawdzenia” = do potwierdzenia przed publikacją.
          </p>
          <nav className="mt-4 flex flex-wrap gap-1 text-sm">
            {sections.map(([id, l]) => (
              <a key={id} href={`#${id}`} className="rounded-lg px-3 py-1.5 text-black/60 hover:bg-black/[.04] hover:text-black">
                {l}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-10 px-4 py-8">
        {data.campaigns.length ? (
          <section className="text-sm text-black/70">
            {data.campaigns.map((c) => (
              <p key={c.code}>
                <b>{c.name}</b> ({c.code}){c.businessName ? ` · nazwa firmy: ${c.businessName}` : ""} · URL: {c.url ?? "do ustalenia"}
              </p>
            ))}
          </section>
        ) : null}

        <section id="grafiki" className="space-y-4" data-testid="share-images">
          <h2 className="text-xl font-semibold">Grafiki — {ready(data.concepts).length} z {data.concepts.length} konceptów gotowe</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {data.concepts.map((c) => (
              <article key={c.conceptId} className={`space-y-3 rounded-2xl border border-black/10 bg-white p-4 ${c.status === "blokada" ? "opacity-70" : ""}`} data-testid="share-concept">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {c.conceptId} · „{c.headline}”
                    </p>
                    <p className="text-xs text-black/55">
                      {[c.subheadline, c.cta && `CTA: ${c.cta}`, c.experiment && `test ${c.experiment}`, c.landing && `LP: ${c.landing}`, c.clean && "czyste zdjęcie"].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Badge s={c.status} />
                </div>
                <div className="flex items-end gap-2">
                  {c.images.map((i) => (
                    <figure key={i.id} className={i.key === "landscape" ? "w-[46%]" : i.key === "square" ? "w-[26%]" : "w-[22%]"}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`${base}/render/${i.id}`} alt={`${c.conceptId} ${i.format}`} loading="lazy" className="w-full rounded border border-black/10 bg-[#eee]" />
                      <figcaption className="mt-1 flex items-center justify-between gap-1 text-[11px] text-black/55">
                        <span>{i.size}</span>
                        {i.status !== "blokada" ? (
                          <a href={`${base}/render/${i.id}?download=1`} className="inline-flex items-center gap-0.5 underline" data-testid="share-image-download">
                            <Download className="h-3 w-3" /> PNG
                          </a>
                        ) : null}
                      </figcaption>
                    </figure>
                  ))}
                </div>
                {c.problems.length ? <p className={`text-xs ${c.status === "blokada" ? "text-red-700" : "text-amber-800"}`}>{c.problems.join(" · ")}</p> : null}
                {c.status !== "blokada" ? (
                  <a className={btn} href={`${base}/zip?concepts=${encodeURIComponent(c.conceptId)}`}>
                    <Package className="h-4 w-4" /> Zestaw {c.conceptId} (3 formaty + manifest)
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <section id="teksty" className="space-y-4" data-testid="share-texts">
          <h2 className="text-xl font-semibold">Teksty reklam</h2>
          {data.texts.map((k) => (
            <div key={k.kind} className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {k.label} <span className="text-sm font-normal text-black/50">(maks. {k.max} znaków)</span>
                </p>
                {ready(k.items).length ? <CopyBtn text={ready(k.items).map((t) => t.text).join("\n")} label={`Kopiuj gotowe (${ready(k.items).length})`} /> : null}
              </div>
              <ul className="divide-y divide-black/5">
                {k.items.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm" data-testid="share-text">
                    <span className="w-12 shrink-0 font-mono text-[11px] text-black/45">{t.assetKey}</span>
                    <span className={`min-w-0 flex-1 ${t.status === "blokada" ? "text-black/45 line-through" : ""}`}>{t.text}</span>
                    <span className="text-xs tabular-nums text-black/45">
                      {t.len}/{k.max}
                    </span>
                    <Badge s={t.status} />
                    {t.status !== "blokada" ? <CopyBtn text={t.text} /> : null}
                    {t.problems.length ? <span className="basis-full pl-14 text-xs text-black/55">{t.problems.join(" · ")}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {data.sitelinks.length ? (
          <section id="sitelinki" className="space-y-3">
            <h2 className="text-xl font-semibold">Sitelinki</h2>
            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <ul className="divide-y divide-black/5 text-sm">
                {data.sitelinks.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-start gap-2 py-2" data-testid="share-sitelink">
                    <span className="w-10 shrink-0 font-mono text-[11px] text-black/45">{x.assetKey}</span>
                    <span className="min-w-0 flex-1">
                      <b>{x.text}</b>
                      <span className="block text-xs text-black/55">
                        {x.d1} · {x.d2} — {x.url || "brak URL"}
                      </span>
                      {x.problems.length ? <span className="block text-xs text-black/55">{x.problems.join(" · ")}</span> : null}
                    </span>
                    <Badge s={x.status} />
                    {x.status !== "blokada" ? <CopyBtn text={[x.text, x.d1, x.d2, x.url].join("\t")} /> : null}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {data.videos.length ? (
          <section id="wideo" className="space-y-3" data-testid="share-videos">
            <h2 className="text-xl font-semibold">Wideo — scenariusze do nagrania</h2>
            {data.videos.map((v) => (
              <div key={v.conceptId} className="space-y-2 rounded-2xl border border-black/10 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {v.conceptId} · „{v.headline}” <span className="text-sm font-normal text-black/50">({v.formats.join(", ")})</span>
                  </p>
                  <span className="flex items-center gap-2">
                    <Badge s={v.status} />
                    {v.status !== "blokada" ? (
                      <a className={btn} href={`${base}/zip?concepts=${encodeURIComponent(v.conceptId)}&parts=videos`}>
                        <Download className="h-4 w-4" /> Napisy, prompter, MP4
                      </a>
                    ) : null}
                  </span>
                </div>
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-black/45">
                    <tr>
                      <th className="w-20 py-1">Czas</th>
                      <th>Lektor / ekspert</th>
                      <th>Napis</th>
                      <th>Kadr</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.scenes.map((s, i) => (
                      <tr key={i} className="border-t border-black/5 align-top">
                        <td className="py-1 text-xs tabular-nums">{s.t}</td>
                        <td className="py-1 pr-2">{s.spoken}</td>
                        <td className="py-1 pr-2 text-black/70">{s.screen}</td>
                        <td className="py-1 text-xs text-black/55">{s.visual}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {v.problems.length ? <p className="text-xs text-black/55">{v.problems.join(" · ")}</p> : null}
              </div>
            ))}
          </section>
        ) : null}

        {data.landing.length ? (
          <section id="landing" className="space-y-3" data-testid="share-landing">
            <h2 className="text-xl font-semibold">Landing page — treść wariantów</h2>
            <div className="grid gap-3 md:grid-cols-3">
              {data.landing.map((l) => (
                <div key={l.id} className="space-y-2 rounded-2xl border border-black/10 bg-white p-4 text-sm">
                  <p className="font-medium">{l.label}</p>
                  <p className="text-xs text-black/55">URL: {l.url ?? "do ustalenia"}</p>
                  {l.exportable ? (
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        {(["html", "md", "json", "csv"] as const).map((f) => (
                          <a key={f} className={btn} href={`${base}/landing?variant=${l.id}&fmt=${f}`}>
                            <Download className="h-3.5 w-3.5" /> {f.toUpperCase()}
                          </a>
                        ))}
                      </div>
                      {l.claimsRemoved ? <p className="text-xs text-amber-800">Niepotwierdzone twierdzenia zostały usunięte z tej wersji.</p> : null}
                    </>
                  ) : (
                    <p className="text-xs text-red-700">Niedostępne do wdrożenia: {l.reasons.join(", ")}.</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section id="brief" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-semibold">Brief dla agencji</h2>
            <CopyBtn text={data.brief} label="Kopiuj brief" />
          </div>
          <pre className="whitespace-pre-wrap rounded-2xl border border-black/10 bg-white p-4 font-sans text-sm leading-relaxed" data-testid="share-brief">
            {data.brief}
          </pre>
        </section>
      </main>
      <footer className="px-4 pb-10 text-center text-xs text-black/40">Podgląd tylko do odczytu · link może zostać odwołany przez właściciela projektu</footer>
    </div>
  );
}
