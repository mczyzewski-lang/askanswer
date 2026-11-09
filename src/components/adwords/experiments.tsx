"use client";
import { useState } from "react";
import { FlaskConical, Package } from "lucide-react";
import { Card, NativeSelect } from "@/components/ui";
import { api, cn } from "@/lib/utils";
import { armLimits, experimentChecks, experiments, MODE_NOTE, type Arm } from "@/lib/adwords/experiments";
import { formatKeyOf } from "@/lib/adwords/spec";
import { experimentLandingCheck } from "@/lib/adwords/landing-content";
import { CreativeCanvas, SceneCanvas } from "./canvas";
import { useCreativeInput } from "./images";
import { HistoricalEvidence } from "./history";
import type { AwAsset, AwData, Toast } from "./types";

const ORDER = ["landscape", "square", "portrait"];

export function ExperimentsTab({ data, reload, toast }: { data: AwData; reload: () => Promise<void>; toast: Toast }) {
  const list = experiments(data.assets);
  const [open, setOpen] = useState(list[0]?.id ?? "");
  if (!list.length) return <Card className="p-6 text-sm text-muted">Brak eksperymentów — zaimportuj CSV v2 z kolumnami experiment_id / variant (np. T01–T05).</Card>;
  const e = list.find((x) => x.id === open) ?? list[0];
  return (
    <div className="space-y-4" data-testid="experiments">
      <div className="flex flex-wrap gap-2">
        {list.map((x) => {
          const bad = experimentChecks(x).some((c) => c.level === "blokada");
          return (
            <button key={x.id} type="button" onClick={() => setOpen(x.id)} className={cn("rounded-xl border px-3 py-2 text-left text-sm", x.id === e.id ? "border-ink bg-white" : "border-line hover:bg-white")} data-testid="experiment-card">
              <span className="flex items-center gap-1.5 font-medium">
                <FlaskConical className="h-4 w-4" /> {x.id} {bad ? <span className="text-red-600">⛔</span> : null}
              </span>
              <span className="block text-xs text-muted">{x.testAxis ?? x.axis}</span>
            </button>
          );
        })}
      </div>
      <ExperimentView key={e.id} e={e} data={data} reload={reload} toast={toast} />
    </div>
  );
}

function ExperimentView({ e, data, reload, toast }: { e: ReturnType<typeof experiments>[number]; data: AwData; reload: () => Promise<void>; toast: Toast }) {
  const lpCheck = experimentLandingCheck(data.assets.filter((a) => a.experimentId === e.id && a.rowType !== "experiment_plan") as never);
  const checks = [...experimentChecks(e), ...(lpCheck ? [{ level: lpCheck.level === "ok" ? "ok" : "blokada", message: lpCheck.message }] : [])] as ReturnType<typeof experimentChecks>;
  const base = `/api/admin/adwords/${data.project.id}`;
  const setMode = async (m: string) => {
    try {
      await api(`${base}/experiments/${e.id}`, { method: "PATCH", json: { deployMode: m } });
      await reload();
    } catch (err) {
      toast((err as Error).message, "err");
    }
  };
  return (
    <Card className="space-y-4 p-5" data-testid="experiment-view">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold">
            {e.id}: {e.plan?.headline ?? e.testAxis}
          </p>
          <p className="text-sm text-muted">
            Zmienna: {e.testAxis ?? e.axis}
            {e.plan?.body ? ` · ${e.plan.body}` : ""}
          </p>
          {e.plan?.scoreNote ? <p className="text-sm">Cel / KPI: {e.plan.scoreNote}</p> : null}
        </div>
        <label className="text-sm">
          Tryb
          <NativeSelect className="ml-2 h-9 w-56" value={e.mode} onChange={(x) => void setMode(x.target.value)} aria-label="Tryb testu" disabled={!data.canEdit} data-testid="experiment-mode">
            <option value="exploration">Szybki — Exploration</option>
            <option value="controlled">A/B — Controlled</option>
          </NativeSelect>
        </label>
      </div>
      <p className={cn("rounded-lg px-3 py-2 text-sm", e.mode === "exploration" ? "bg-amber-50 text-amber-900" : "bg-sky-50 text-sky-900")} data-testid="mode-note">
        {MODE_NOTE[e.mode]}
        {e.mode === "controlled" ? <span className="mt-1 block text-xs">{MODE_NOTE.fallback}</span> : null}
      </p>
      <ul className="space-y-0.5 text-sm" data-testid="experiment-checks">
        {checks.map((c, i) => (
          <li key={i} className={c.level === "blokada" ? "text-red-700" : c.level === "do_poprawy" ? "text-amber-800" : "text-emerald-700"}>
            {c.level === "ok" ? "✓" : c.level === "blokada" ? "⛔" : "⚠"} {c.message}
          </li>
        ))}
      </ul>
      {e.evidence.length ? (
        <div className="text-xs text-muted" data-testid="evidence-note">
          {e.evidence.map((x) => (
            <p key={x}>Dowód / kontekst: {x}</p>
          ))}
        </div>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        {(["A", "B"] as const).map((v) => (
          <ArmView key={v} arm={e.arms[v]} data={data} experimentId={e.id} />
        ))}
      </div>
    </Card>
  );
}

function ArmView({ arm, data, experimentId }: { arm: Arm; data: AwData; experimentId: string }) {
  const toInput = useCreativeInput(data);
  const head = arm.texts.find((t) => t.rowType === "headline")?.adText ?? arm.images[0]?.headline ?? "";
  const imgs = [...arm.images].sort((a, b) => ORDER.indexOf(formatKeyOf(a.aspectRatio, a.width, a.height) ?? "") - ORDER.indexOf(formatKeyOf(b.aspectRatio, b.width, b.height) ?? "")) as AwAsset[];
  const v = arm.videos[0];
  return (
    <div className="space-y-3 rounded-xl border border-line p-3" data-testid={`arm-${arm.variant}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">
          Wariant {arm.variant}: „{head}”
        </p>
        <a href={`/api/admin/adwords/${data.project.id}/zip?fmt=png&experiment=${experimentId}&variant=${arm.variant}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-xs font-medium text-white" data-testid={`export-arm-${arm.variant}`}>
          <Package className="h-3.5 w-3.5" /> Eksportuj wariant {arm.variant}
        </a>
      </div>
      <p className="text-xs text-muted">{armLimits(arm).map((c) => c.message).join(" · ")}</p>
      {imgs.length ? (
        <div className="flex items-end gap-2">
          {imgs.map((a) => {
            const k = formatKeyOf(a.aspectRatio, a.width, a.height);
            return <CreativeCanvas key={a.id} input={toInput(a)} className={cn("rounded border border-line bg-white", k === "landscape" ? "w-[46%]" : k === "square" ? "w-[26%]" : "w-[22%]")} />;
          })}
        </div>
      ) : null}
      {v ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">
            Wideo {v.conceptId} ({v.variants.map((x) => x.aspectRatio).join(", ")}) — skrypt scena po scenie
          </p>
          <div className="flex gap-1.5 overflow-x-auto">
            {v.scenes.map((s, i) => (
              <div key={s.assetKey} className="w-24 shrink-0 space-y-0.5">
                <SceneCanvas className="w-full rounded border border-line" input={{ width: 270, height: 480, theme: data.theme, screenText: s.screenText || s.spokenText || "", visualBrief: s.visualBrief, sceneLabel: `${s.startS}–${s.endS} s`, logoUrl: data.logoUrl, photo: null, isCta: i === v.scenes.length - 1 && v.scenes.length > 1 }} />
              </div>
            ))}
          </div>
          <ol className="space-y-0.5 text-xs">
            {v.scenes.map((s) => (
              <li key={s.assetKey} className={cn((s.startS ?? 0) < 3 && "font-semibold")}>
                {s.startS}–{s.endS} s: „{s.spokenText}” <span className="text-muted">/ napis: {s.screenText}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {arm.variant === "A" ? <HistoricalEvidence data={data} conceptId={arm.images[0]?.conceptId ?? null} text={head} /> : <p className="text-xs text-muted">B: hipoteza — wymaga testu A/B (brak historii dla nowego brzmienia).</p>}
    </div>
  );
}
