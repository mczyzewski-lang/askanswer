"use client";
import { useMemo, useState } from "react";
import { Copy, Download, Monitor, Smartphone } from "lucide-react";
import { Button, Card, NativeSelect } from "@/components/ui";
import { cn } from "@/lib/utils";
import { LANDING_RULES, LANDING_SOURCES, landingMarkdown, landingPlan, type LandingPlan } from "@/lib/adwords/landing";
import { download } from "./video";
import type { AwData, Toast } from "./types";

/** How the landing page of a campaign should look — a mock in the project's theme + a spec for the web team. */
export function LandingTab({ data, toast }: { data: AwData; toast: Toast }) {
  const [campaign, setCampaign] = useState(data.campaigns[0]?.code ?? "");
  const [concept, setConcept] = useState<string | null>(null);
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const camp = data.campaigns.find((c) => c.code === campaign) ?? null;
  const plan = useMemo(() => landingPlan({ projectName: data.project.name, campaign: camp, assets: data.assets, conceptId: concept, photos: data.photos }), [data, camp, concept]);
  const md = landingMarkdown(plan, data.project.name, camp?.name ?? null);
  const photo = plan.hero.expert ? data.photos.find((p) => p.id === plan.hero.expert!.id) : null;
  return (
    <div className="space-y-4" data-testid="landing">
      <Card className="space-y-3 p-5">
        <p className="font-medium">Jak powinien wyglądać landing page</p>
        <p className="text-sm text-muted">Wzór strony docelowej dla wybranej kampanii — zbudowany z Twoich reklam (to samo hasło i CTA = spójność reklamy ze stroną), motywu projektu i zasad Google dla stron docelowych. To specyfikacja dla osoby, która robi stronę — nic tu nie publikujemy.</p>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect className="h-9 w-56" value={campaign} onChange={(e) => (setCampaign(e.target.value), setConcept(null))} aria-label="Kampania landing page">
            {data.campaigns.length ? null : <option value="">— wszystkie komponenty —</option>}
            {data.campaigns.map((c) => (
              <option key={c.id} value={c.code}>
                {c.name} ({c.goal === "poradnik" ? "poradnik" : "sprzedaż"})
              </option>
            ))}
          </NativeSelect>
          {plan.concepts.length ? (
            <NativeSelect className="h-9 w-56" value={plan.conceptId ?? ""} onChange={(e) => setConcept(e.target.value)} aria-label="Koncept wiodący">
              {plan.concepts.map((c) => (
                <option key={c} value={c}>
                  Koncept wiodący: {c}
                </option>
              ))}
            </NativeSelect>
          ) : null}
          <div className="flex rounded-lg border border-line p-0.5">
            {(["mobile", "desktop"] as const).map((d) => (
              <button key={d} type="button" onClick={() => setDevice(d)} className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs", device === d ? "bg-ink text-white" : "text-muted hover:text-ink")} aria-pressed={device === d}>
                {d === "mobile" ? <Smartphone className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />} {d === "mobile" ? "Telefon" : "Komputer"}
              </button>
            ))}
          </div>
          <Button variant="ghost" onClick={() => download(`landing_page_${camp?.code ?? "projekt"}.md`, md, "text/markdown;charset=utf-8")} data-testid="landing-download">
            <Download /> Pobierz specyfikację (.md)
          </Button>
          <Button variant="ghost" onClick={() => void navigator.clipboard.writeText(md).then(() => toast("Skopiowano specyfikację"))}>
            <Copy /> Kopiuj
          </Button>
        </div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex items-start justify-center self-start rounded-xl border border-line bg-black/[.03] p-4">
          <LandingMock plan={plan} data={data} photoUrl={photo?.consentConfirmed ? photo.url : null} mobile={device === "mobile"} business={camp?.businessName || data.project.name} />
        </div>
        <div className="space-y-4">
          <Card className="space-y-2 p-4" data-testid="landing-checks">
            <p className="text-sm font-medium">Kontrola na podstawie danych projektu</p>
            <ul className="space-y-1 text-sm">
              {plan.checks.map((c, i) => (
                <li key={i} className={c.level === "blokada" ? "text-red-700" : c.level === "do_poprawy" ? "text-amber-800" : c.level === "ok" ? "text-emerald-700" : "text-muted"}>
                  {c.level === "ok" ? "✓" : c.level === "blokada" ? "⛔" : c.level === "do_poprawy" ? "⚠" : "ℹ"} <b className="font-medium">{c.area}:</b> {c.message}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="space-y-3 p-4" data-testid="landing-sections">
            <p className="text-sm font-medium">Sekcje strony — od góry</p>
            {plan.sections.map((s) => (
              <div key={s.key} className="space-y-1">
                <p className="text-sm font-medium">{s.title}</p>
                <p className="text-xs text-muted">{s.purpose}</p>
                <ul className="list-disc space-y-0.5 pl-5 text-sm">
                  {s.items.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            ))}
          </Card>
        </div>
      </div>
      <Card className="space-y-2 p-5" data-testid="landing-rules">
        <p className="font-medium">Zasady strony docelowej</p>
        <table className="w-full text-left text-sm">
          <tbody>
            {LANDING_RULES.map((r, i) => (
              <tr key={i} className="border-b border-line/60 align-top">
                <td className="w-36 py-1.5 pr-3 text-muted">{r.area}</td>
                <td className="py-1.5">
                  {r.rule}
                  {r.own ? <span className="ml-1 text-xs text-muted">(rekomendacja własna)</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted">
          Źródła:{" "}
          {LANDING_SOURCES.map((s, i) => (
            <span key={s.url}>
              {i ? " · " : ""}
              <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                {s.title}
              </a>
            </span>
          ))}
        </p>
      </Card>
    </div>
  );
}

const lum = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** the theme colour that stands out most on the page background (the CTA must be seen) + readable text on it */
function ctaColors(t: AwData["theme"]) {
  const bg = [t.primary, t.accent, t.highlight, t.secondary].reduce((best, c) => (contrast(c, t.background) > contrast(best, t.background) ? c : best), t.primary);
  const fg = contrast(t.background, bg) >= contrast(t.text, bg) ? t.background : t.text;
  return { bg, fg: contrast(fg, bg) >= 4.5 ? fg : lum(bg) > 0.4 ? "#111111" : "#ffffff" };
}

/** a wireframe of the page in the project's theme (not a pixel-perfect design) */
function LandingMock({ plan, data, photoUrl, mobile, business }: { plan: LandingPlan; data: AwData; photoUrl: string | null; mobile: boolean; business: string }) {
  const t = data.theme;
  const c = ctaColors(t);
  const head = { fontFamily: `"${t.questionFont}", system-ui, sans-serif` };
  const bodyF = { fontFamily: `"${t.subtitleFont}", system-ui, sans-serif` };
  const cta = (
    <span className="inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold" style={{ background: c.bg, color: c.fg }}>
      {plan.hero.cta}
    </span>
  );
  const section = (title: string, children: React.ReactNode, alt = false) => (
    <section className={cn(mobile ? "px-4 py-5" : "px-10 py-8")} style={{ background: alt ? `${t.secondary}22` : t.background }}>
      <p className="mb-3 text-lg font-bold" style={{ ...head, color: t.text }}>
        {title}
      </p>
      {children}
    </section>
  );
  const sec = (k: string) => plan.sections.find((s) => s.key === k);
  return (
    <div className={cn("relative self-start overflow-hidden rounded-[18px] border-4 border-ink/80 shadow-lg", mobile ? "w-[320px]" : "w-full max-w-[760px]")} data-testid="landing-mock">
      <div className="max-h-[680px] overflow-y-auto" style={{ ...bodyF, background: t.background, color: t.text }}>
        <header className={cn("flex items-center justify-between border-b", mobile ? "px-4 py-3" : "px-10 py-4")} style={{ borderColor: `${t.text}1a` }}>
          {data.logoUrl ? <img src={data.logoUrl} alt="" className="h-7 w-auto" /> : <span className="text-sm font-bold" style={head}>{business}</span>}
          <span className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: c.bg, color: c.bg }}>
            ☎ Zadzwoń
          </span>
        </header>
        <section className={cn("grid items-center gap-5", mobile ? "px-4 py-6" : "grid-cols-[1.2fr_1fr] px-10 py-10")}>
          <div className="space-y-3">
            <h2 className={cn("font-extrabold leading-tight", mobile ? "text-2xl" : "text-[32px]")} style={{ ...head, color: t.text }} data-testid="landing-h1">
              {plan.hero.headline}
            </h2>
            {plan.hero.subheadline ? <p className="text-sm opacity-80">{plan.hero.subheadline}</p> : null}
            {cta}
            {plan.hero.proof ? (
              <p className="text-xs" style={{ color: t.accent }}>
                ✓ {plan.hero.proof}
              </p>
            ) : null}
          </div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl" style={{ background: `linear-gradient(135deg, ${t.secondary}, ${t.accent})` }}>
            {photoUrl ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : <span className="absolute inset-0 grid place-items-center text-xs text-white/80">zdjęcie eksperta</span>}
            {plan.hero.expert ? (
              <span className="absolute bottom-2 left-2 rounded bg-black/55 px-2 py-0.5 text-[11px] text-white">
                {plan.hero.expert.name}
                {plan.hero.expert.role ? ` · ${plan.hero.expert.role}` : ""}
              </span>
            ) : null}
          </div>
        </section>
        {section(
          sec("inside")?.title.replace(/^\d+\.\s*/, "") ?? "Dla kogo",
          <ul className="space-y-1.5 text-sm">
            {(sec("inside") ?? sec("problem"))!.items.slice(0, 3).map((x, i) => (
              <li key={i} className="flex gap-2">
                <span style={{ color: t.accent }}>●</span> {x.replace(/^„|”$/g, "")}
              </li>
            ))}
          </ul>,
          true,
        )}
        {section(
          "Jak to wygląda",
          <div className={cn("grid gap-3", mobile ? "" : "grid-cols-3")}>
            {plan.steps.map((s, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border p-3 text-sm" style={{ borderColor: `${t.text}1a` }}>
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold" style={{ background: t.accent, color: t.background }}>
                  {i + 1}
                </span>
                {s}
              </div>
            ))}
          </div>,
        )}
        {section(
          "Kto prowadzi sprawę",
          <div className="flex items-center gap-3 text-sm">
            <span className="h-14 w-14 shrink-0 overflow-hidden rounded-full" style={{ background: t.secondary }}>
              {photoUrl ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : null}
            </span>
            <span>
              <b>{plan.hero.expert?.name ?? "Imię i nazwisko"}</b>
              <span className="block text-xs opacity-70">{plan.hero.expert?.role ?? "tytuł zawodowy, nr wpisu"} — krótkie bio</span>
            </span>
          </div>,
          true,
        )}
        {sec("price")
          ? section(
              "Koszt i zakres",
              <div className="rounded-lg border p-3 text-sm" style={{ borderColor: c.bg }}>
                <p className="font-semibold">Konsultacja — cena i co obejmuje</p>
                <p className="text-xs opacity-70">ta sama kwota co w reklamie · brutto · czego nie obejmuje</p>
              </div>,
            )
          : null}
        {section(
          "Najczęstsze pytania",
          <div className="divide-y text-sm" style={{ borderColor: `${t.text}1a` }}>
            {sec("faq")!.items.slice(0, 4).map((q, i) => (
              <p key={i} className="flex justify-between py-2">
                {q.replace(/^„|”$/g, "")} <span className="opacity-50">+</span>
              </p>
            ))}
          </div>,
          true,
        )}
        {section(
          plan.goal === "poradnik" ? "Pobierz poradnik" : "Umów się",
          <div className="space-y-2">
            {(plan.goal === "poradnik" ? ["E-mail"] : ["Imię", "Telefon lub e-mail", "Krótko, w czym pomóc (opcjonalnie)"]).map((f) => (
              <div key={f} className="rounded-md border px-3 py-2 text-xs opacity-70" style={{ borderColor: `${t.text}33` }}>
                {f}
              </div>
            ))}
            <p className="text-[11px] opacity-60">☐ Zgoda na kontakt · polityka prywatności · tajemnica zawodowa</p>
            {cta}
          </div>,
        )}
        <footer className={cn("text-[11px]", mobile ? "px-4 py-4 pb-16" : "px-10 py-5")} style={{ background: t.text, color: t.background }}>
          {business} · adres · NIP · telefon · e-mail · Polityka prywatności · Regulamin
        </footer>
      </div>
      {mobile ? (
        <div className="absolute inset-x-0 bottom-0 flex gap-2 border-t p-2" style={{ background: t.background, borderColor: `${t.text}1a` }}>
          <span className="flex-1 rounded-lg py-2 text-center text-sm font-semibold" style={{ background: c.bg, color: c.fg }}>
            {plan.hero.cta}
          </span>
          <span className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: c.bg, color: c.bg }}>
            ☎
          </span>
        </div>
      ) : null}
    </div>
  );
}
