"use client";
import { useState } from "react";
import Link from "next/link";
import { Download, Film, Loader2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, NativeSelect, Progress } from "@/components/ui";
import { api, formatDate } from "@/lib/utils";
import { EXPORT_FORMATS } from "@/lib/editor/factory";
import type { PanelProps } from "./project-view";

export function CombinedPanel({ data, refresh, toast }: PanelProps) {
  const videos = data.questions.flatMap((q) => q.takes.filter((t) => t.compositionId).map((t) => ({ q, t })));
  const [selected, setSelected] = useState<string[]>([]);
  const [format, setFormat] = useState("1080x1920");
  const [quality, setQuality] = useState("standard");
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        <p className="mb-3 text-sm text-muted">Każde pytanie ma własny, niezależny film. Zaznacz kilka, aby połączyć je w jeden dłuższy wywiad (w kolejności zaznaczenia).</p>
        {videos.length === 0 ? (
          <EmptyState icon={<Film className="h-8 w-8" />} title="Brak filmów do połączenia">
            Filmy pojawią się tutaj po przetworzeniu nagrań.
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {videos.map(({ q, t }) => {
              const idx = selected.indexOf(t.compositionId!);
              return (
                <Card key={t.id} className="flex items-center gap-3 p-3">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={idx >= 0} onChange={() => toggle(t.compositionId!)} aria-label={`Wybierz: ${q.text}`} />
                  <span className="tabular w-6 text-sm font-semibold text-brand">{idx >= 0 ? idx + 1 : ""}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{q.text}</p>
                    <p className="text-xs text-muted">Ujęcie {t.takeNumber}</p>
                  </div>
                  {t.compositionStatus === "EXPORTED" ? <Badge tone="green">wyeksportowany</Badge> : t.compositionStatus === "EDITED" ? <Badge tone="blue">zmontowany</Badge> : <Badge>gotowy do edycji</Badge>}
                  <Link href={`/studio/${t.compositionId}`} className="text-sm font-medium text-brand">
                    Studio
                  </Link>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      <div className="space-y-4">
        <Card className="space-y-3 p-4">
          <p className="font-medium">Połączony wywiad</p>
          <NativeSelect value={format} onChange={(e) => setFormat(e.target.value)} aria-label="Format">
            {Object.entries(EXPORT_FORMATS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={quality} onChange={(e) => setQuality(e.target.value)} aria-label="Jakość">
            <option value="standard">Jakość standardowa</option>
            <option value="high">Wysoka jakość (wolniej)</option>
            <option value="draft">Szkic (szybko)</option>
          </NativeSelect>
          <Button
            className="w-full"
            disabled={selected.length < 2}
            onClick={async () => {
              try {
                await api(`/api/admin/projects/${data.project.id}/combined-render`, { method: "POST", json: { compositionIds: selected, format, quality } });
                toast("Rozpoczęto renderowanie");
                setSelected([]);
                refresh();
              } catch (err) {
                toast((err as Error).message, "err");
              }
            }}
          >
            Połącz {selected.length >= 2 ? `${selected.length} filmy` : "(wybierz min. 2)"}
          </Button>
        </Card>
        {data.combined.length ? (
          <Card className="space-y-3 p-4">
            <p className="font-medium">Historia</p>
            {data.combined.map((c) => (
              <div key={c.id} className="space-y-1.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span>
                    {c.count} filmów · {formatDate(c.createdAt)}
                  </span>
                  {c.status === "SUCCEEDED" && c.downloadUrl ? (
                    <a href={c.downloadUrl} className="inline-flex items-center gap-1 font-medium text-brand">
                      <Download className="h-4 w-4" /> MP4
                    </a>
                  ) : c.status === "FAILED" ? (
                    <Badge tone="red">błąd</Badge>
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-muted" />
                  )}
                </div>
                {c.status === "RUNNING" || c.status === "QUEUED" ? <Progress value={c.progress} /> : null}
                {c.error && c.status !== "SUCCEEDED" ? <p className="text-xs text-red-600">{c.error}</p> : null}
              </div>
            ))}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
