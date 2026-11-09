"use client";
import { V5_GROUPS, groupOf } from "@/lib/adwords/csv";
import type { AwAsset } from "./types";

const SHOWN = ["test", "historical", "score", "proof", "cta", "match", "page"];
/** the CSV v5 data of a record that has no field of its own in the editor — scoring, history, test priorities, proofs */
export function CsvV5Fields({ asset }: { asset: AwAsset }) {
  const lp = asset.lp ?? {};
  const groups = V5_GROUPS.filter((g) => SHOWN.includes(g.key))
    .map((g) => [g, Object.entries(lp).filter(([k, v]) => groupOf(k) === g.key && v)] as const)
    .filter(([, xs]) => xs.length);
  const typed = [asset.testPriority != null ? ["test_priority", String(asset.testPriority)] : null, asset.experimentId ? ["experiment_id", `${asset.experimentId}${asset.variant ? ` / ${asset.variant}` : ""}`] : null, asset.pairedAssetId ? ["paired_asset_id", asset.pairedAssetId] : null, asset.scoreSeed != null ? ["score_seed", String(asset.scoreSeed)] : null].filter(Boolean) as Array<[string, string]>;
  if (!groups.length && !typed.length) return null;
  return (
    <details className="rounded-lg border border-line px-3 py-2 text-xs" data-testid="v5-fields">
      <summary className="cursor-pointer font-medium">Dane z CSV v5 — testy, historia, scoring, dowody</summary>
      {typed.length ? (
        <dl className="mt-2 grid grid-cols-[140px_1fr] gap-x-2 gap-y-0.5">
          {typed.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {groups.map(([g, xs]) => (
        <div key={g.key} className="mt-2">
          <p className="font-medium">{g.label}</p>
          <dl className="grid grid-cols-[140px_1fr] gap-x-2 gap-y-0.5">
            {xs.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="break-all font-mono text-muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </details>
  );
}
