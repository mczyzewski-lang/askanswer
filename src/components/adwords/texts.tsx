"use client";
import { useMemo, useState } from "react";
import { Copy, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { api, cn } from "@/lib/utils";
import { PMAX_SPEC, type TextKind } from "@/lib/adwords/spec";
import { brandContext, gateOptionsOf } from "@/lib/adwords/context";
import { AdLandingInfo } from "./landing-content";
import { gateSitelink, gateText, scoreTextA, scoreTextB, textSetChecks } from "@/lib/adwords/score";
import { GateBadge, ScorePair } from "./scores";
import type { AwAsset, AwData, Toast } from "./types";

const KINDS: TextKind[] = ["headline", "long_headline", "description"];

export function TextsTab({ data, reload, toast }: { data: AwData; reload: () => Promise<void>; toast: Toast }) {
  const groups = [...new Set(data.assets.filter((a) => KINDS.includes(a.rowType as TextKind)).map((a) => a.assetGroup ?? "—"))];
  const [group, setGroup] = useState(groups[0] ?? "—");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [seed, setSeed] = useState(0);
  const texts = data.assets.filter((a) => KINDS.includes(a.rowType as TextKind) && (a.assetGroup ?? "—") === group);
  const live = texts.map((t) => ({ ...t, adText: drafts[t.id] ?? t.adText }));
  const ctx = brandContext({ name: data.project.name, adwordsBrief: data.project.brief }, null, !!data.logoUrl);
  const checks = textSetChecks(live);
  const combo = useMemo(() => {
    const pick = (k: TextKind) => {
      const l = live.filter((t) => t.rowType === k && (t.adText ?? "").trim());
      return l.length ? l[(seed * 7 + k.length) % l.length].adText : "";
    };
    return { h: pick("headline"), lh: pick("long_headline"), d: pick("description") };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, JSON.stringify(live.map((t) => t.adText))]);
  const save = async (t: AwAsset) => {
    const v = drafts[t.id];
    if (v == null || v === t.adText) return;
    try {
      await api(`/api/admin/adwords/${data.project.id}/assets/${t.id}`, { method: "PATCH", json: { adText: v } });
      await reload();
      setDrafts(({ [t.id]: _gone, ...rest }) => (void _gone, rest));
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const copy = async (text: string, msg = "Skopiowano") => {
    await navigator.clipboard?.writeText(text).catch(() => {});
    toast(msg);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {groups.length > 1
          ? groups.map((g) => (
              <button key={g} type="button" onClick={() => setGroup(g)} className={cn("rounded-lg border px-3 py-1.5 text-sm", g === group ? "border-ink bg-white" : "border-line")}>
                {g}
              </button>
            ))
          : null}
      </div>
      <Card className="space-y-2 p-4" data-testid="text-checklist">
        <p className="text-sm font-medium">Kompletność grupy {group}</p>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {checks.map((c, i) => (
            <li key={i} className={c.level === "blokada" ? "text-red-700" : c.level === "do_poprawy" ? "text-amber-800" : "text-emerald-700"}>
              {c.level === "ok" ? "✓" : c.level === "blokada" ? "⛔" : "⚠"} {c.message}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="space-y-2 p-4" data-testid="combo-preview">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Podgląd kombinacji (przykład, jak Google może złożyć teksty)</p>
          <Button size="sm" variant="ghost" onClick={() => setSeed((s) => s + 1)}>
            <RefreshCw /> Inna kombinacja
          </Button>
        </div>
        <div className="rounded-lg border border-line bg-white p-3">
          <p className="text-[11px] text-muted">Sponsorowane · {data.project.name}</p>
          <p className="text-[17px] text-[#1a0dab]">
            {combo.h}
            {combo.lh ? ` | ${combo.lh}` : ""}
          </p>
          <p className="text-sm text-[#4d5156]">{combo.d}</p>
        </div>
      </Card>
      {KINDS.map((k) => {
        const s = PMAX_SPEC.texts[k];
        const list = live.filter((t) => t.rowType === k);
        return (
          <Card key={k} className="space-y-2 p-4" data-testid={`texts-${k}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {s.label} <span className="text-sm font-normal text-muted">({list.length}/{s.maxCount}, maks. {s.maxChars} znaków)</span>
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => void copy(list.map((t) => t.adText).join("\n"), `Skopiowano ${list.length} pozycji`)}>
                  <Copy /> Kopiuj wszystkie
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={list.length >= s.maxCount || !data.canEdit}
                  onClick={async () => {
                    await api(`/api/admin/adwords/${data.project.id}/assets`, { method: "POST", json: { rowType: k, adText: "", assetGroup: group === "—" ? null : group, campaignCode: list[0]?.campaignCode ?? null } });
                    await reload();
                  }}
                >
                  <Plus /> Dodaj
                </Button>
              </div>
            </div>
            <ul className="space-y-1.5">
              {list.map((t) => {
                const len = [...(t.adText ?? "")].length;
                const g = gateText(t, gateOptionsOf(data.assets, data.gateLp, data.project.topic));
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-2" data-testid="text-row">
                    <span className="w-12 shrink-0 font-mono text-[11px] text-muted">{t.assetKey}</span>
                    <Input className={cn("min-w-0 flex-1", len > s.maxChars && "border-red-400")} value={t.adText ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))} onBlur={() => void save(t)} aria-label={`${s.label} ${t.assetKey}`} disabled={!data.canEdit} />
                    <span className={cn("w-14 shrink-0 text-right text-xs tabular-nums", len > s.maxChars ? "font-semibold text-red-600" : len <= ("shortOneMaxChars" in s ? s.shortOneMaxChars : 0) ? "text-emerald-700" : "text-muted")} data-testid="char-count">
                      {len}/{s.maxChars}
                    </span>
                    <GateBadge gate={g} />
                    <AdLandingInfo data={data} asset={t} compact />
                    <ScorePair a={scoreTextA(t, live, ctx)} b={scoreTextB(t, live, ctx)} compact />
                    <Button size="iconSm" variant="ghost" aria-label="Kopiuj" onClick={() => void copy(t.adText ?? "")}>
                      <Copy />
                    </Button>
                    <Button
                      size="iconSm"
                      variant="ghost"
                      aria-label={`Usuń ${t.assetKey}`}
                      disabled={!data.canEdit}
                      onClick={async () => {
                        await api(`/api/admin/adwords/${data.project.id}/assets/${t.id}`, { method: "DELETE" });
                        await reload();
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
      <SitelinksCard data={data} />
    </div>
  );
}

/** sitelinks: link text ≤ 25, two descriptions ≤ 35, a real URL; their report metrics concern the whole ad */
function SitelinksCard({ data }: { data: AwData }) {
  const list = data.assets.filter((a) => a.rowType === "sitelink");
  if (!list.length) return null;
  const s = PMAX_SPEC.sitelinks;
  return (
    <Card className="space-y-2 p-4" data-testid="texts-sitelinks">
      <p className="font-medium">
        Linki do podstron (sitelinki) <span className="text-sm font-normal text-muted">({list.length}, tekst ≤ {s.textMax}, opisy ≤ {s.descMax})</span>
      </p>
      <p className="text-xs text-muted">{s.note}</p>
      <ul className="space-y-1.5 text-sm">
        {list.map((t) => {
          const g = gateSitelink(t, gateOptionsOf(data.assets, data.gateLp, data.project.topic));
          const lp = t.lp ?? {};
          return (
            <li key={t.id} className="flex flex-wrap items-start gap-2 border-t border-line/60 pt-1.5" data-testid="sitelink-row">
              <span className="w-10 shrink-0 font-mono text-[11px] text-muted">{t.assetKey}</span>
              <span className="min-w-0 flex-1">
                <b>{t.adText}</b> <span className="text-xs text-muted">({[...(t.adText ?? "")].length}/{s.textMax})</span>
                <span className="block text-xs text-muted">
                  {lp.sitelink_description_1 ?? ""} · {lp.sitelink_description_2 ?? ""} — {t.landingUrl ?? "brak URL"}
                </span>
                {g.problems.length ? <span className="block text-xs text-red-700">{g.problems.map((p) => p.message).join(" · ")}</span> : null}
                {(t as unknown as { extra?: Record<string, string> }).extra?.historical_note ? <span className="block text-xs text-amber-800">{(t as unknown as { extra: Record<string, string> }).extra.historical_note}</span> : null}
              </span>
              <GateBadge gate={g} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
