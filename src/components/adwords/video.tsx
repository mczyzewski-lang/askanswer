"use client";
import { useEffect, useState } from "react";
import { Download, Film, Loader2 } from "lucide-react";
import { Button, Card, Input, NativeSelect, Textarea } from "@/components/ui";
import { api, cn } from "@/lib/utils";
import { brandContext } from "@/lib/adwords/context";
import { gateVideo, scoreVideoA, scoreVideoB } from "@/lib/adwords/score";
import { formatKeyOf, PMAX_SPEC } from "@/lib/adwords/spec";
import { scenesToSrt, shotlistCsv, shotlistMarkdown, teleprompterScript, videoConcepts, videoDuration } from "@/lib/adwords/video";
import { SceneCanvas } from "./canvas";
import { GateBadge, GateList, ScorePair } from "./scores";
import type { AwAsset, AwData, Toast } from "./types";

export function download(name: string, text: string, mime = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const SCENE_COLORS = ["bg-sky-500/80", "bg-violet-500/80", "bg-emerald-500/80", "bg-amber-500/80", "bg-rose-500/80", "bg-teal-500/80"];

export function VideoTab({ data, reload, toast }: { data: AwData; reload: () => Promise<void>; toast: Toast }) {
  const concepts = videoConcepts(data.assets);
  const [open, setOpen] = useState<string | null>(concepts[0]?.conceptId ?? null);
  if (!concepts.length) return <Card className="p-6 text-sm text-muted">Brak koncepcji wideo — zaimportuj CSV z wierszami video i video_scene.</Card>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {concepts.map((v) => {
            const ev = data.evaluation.videos.find((e) => e.conceptId === v.conceptId);
            return (
              <button key={v.conceptId} type="button" onClick={() => setOpen(v.conceptId)} className={cn("flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm", open === v.conceptId ? "border-ink bg-white" : "border-line hover:bg-white")} data-testid="video-concept">
                <Film className="h-4 w-4" /> {v.conceptId} <span className="text-xs text-muted">{v.variants[0]?.funnel ?? ""} · {videoDuration(v)} s</span>
                {ev ? <GateBadge gate={ev.gate} /> : null}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2 text-sm">
          <Button size="sm" variant="outline" onClick={() => download(`${data.project.slug}_shotlista.csv`, shotlistCsv(concepts), "text/csv;charset=utf-8")}>
            <Download /> Shotlista CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => download(`${data.project.slug}_shotlista.md`, shotlistMarkdown(concepts), "text/markdown;charset=utf-8")}>
            Shotlista .md
          </Button>
        </div>
      </div>
      {open ? <VideoConceptView key={open} conceptId={open} data={data} reload={reload} toast={toast} /> : null}
    </div>
  );
}

function VideoConceptView({ conceptId, data, reload, toast }: { conceptId: string; data: AwData; reload: () => Promise<void>; toast: Toast }) {
  const v = videoConcepts(data.assets).find((x) => x.conceptId === conceptId)!;
  const [scenes, setScenes] = useState<AwAsset[]>(v.scenes as AwAsset[]);
  const [orient, setOrient] = useState<"portrait" | "landscape" | "square">("portrait");
  const [files, setFiles] = useState<Array<{ variant: string; width: number; height: number; duration: number; bytes: number; voiced: boolean; url: string; preview: string }>>([]);
  const [job, setJob] = useState<string | null>(null);
  const [voice, setVoice] = useState(true);
  const draftV = { ...v, scenes };
  const dur = videoDuration(draftV);
  const campaign = data.campaigns.find((c) => c.code === v.variants[0]?.campaignCode);
  const ctx = brandContext({ name: data.project.name, adwordsBrief: data.project.brief }, campaign?.landingUrl ?? null, !!data.logoUrl);
  const dirty = JSON.stringify(scenes) !== JSON.stringify(v.scenes);
  const base = `/api/admin/adwords/${data.project.id}`;
  const loadFiles = async () => setFiles((await api<{ files: typeof files }>(`${base}/videos/${conceptId}`)).files);
  useEffect(() => {
    void loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conceptId]);
  useEffect(() => {
    if (!job) return;
    const t = setInterval(async () => {
      const j = await api<{ status: string; error: string | null }>(`/api/admin/jobs/${job}`);
      if (j.status === "SUCCEEDED") {
        setJob(null);
        toast("Gotowe — animatik w 3 formatach");
        await loadFiles();
      } else if (j.status === "FAILED") {
        setJob(null);
        toast(j.error ?? "Nie udało się", "err");
      }
    }, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);
  const set = (id: string, patch: Partial<AwAsset>) => setScenes((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const save = async () => {
    try {
      for (const s of scenes) {
        const o = v.scenes.find((x) => x.id === s.id)!;
        if (JSON.stringify(o) === JSON.stringify(s)) continue;
        await api(`${base}/assets/${s.id}`, { method: "PATCH", json: { startS: s.startS, endS: s.endS, spokenText: s.spokenText, screenText: s.screenText, visualBrief: s.visualBrief } });
      }
      toast("Zapisano scenariusz");
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const photo = (a: AwAsset) => {
    const p = a.expertPhotoId ? data.photos.find((x) => x.id === a.expertPhotoId) : a.expertPhotoKey ? data.photos.find((x) => x.key === a.expertPhotoKey) : null;
    return p && p.consentConfirmed ? { url: p.url, focalX: p.focalX, focalY: p.focalY } : null;
  };
  const f = PMAX_SPEC.videos.formats.find((x) => x.key === orient)!;
  const variantKeys = v.variants.map((x) => formatKeyOf(x.aspectRatio, x.width, x.height));
  return (
    <Card className="space-y-5 p-5" data-testid="video-view">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold">
            {conceptId} · {dur} s
          </p>
          <p className="text-sm text-muted">
            Warianty: {v.variants.map((x) => x.aspectRatio).join(", ") || "brak"} · lejek: {v.variants[0]?.funnel ?? "—"}
            {dur < PMAX_SPEC.videos.minSeconds ? " · za krótki (min. 10 s)" : ""}
          </p>
        </div>
        <ScorePair a={scoreVideoA(draftV, ctx)} b={scoreVideoB(draftV, ctx)} seed={v.variants[0]?.scoreSeed} />
      </div>
      {/* the timeline of scenes */}
      <div>
        <div className="relative h-9 overflow-hidden rounded-lg bg-black/[.04]" data-testid="scene-timeline">
          {scenes.map((s, i) => (
            <div key={s.id} className={cn("absolute top-0 flex h-full items-center overflow-hidden px-1.5 text-[11px] font-medium text-white", SCENE_COLORS[i % SCENE_COLORS.length])} style={{ left: `${((s.startS ?? 0) / Math.max(1, dur)) * 100}%`, width: `${(((s.endS ?? 0) - (s.startS ?? 0)) / Math.max(1, dur)) * 100}%` }} title={s.screenText ?? ""}>
              {s.sceneIndex}. {s.screenText}
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted">
          <span>0 s</span>
          <span>3 s — koniec hooka</span>
          <span>{dur} s</span>
        </div>
      </div>
      <GateList gate={gateVideo(draftV, ctx)} />
      {/* scenes: edit the script and timings */}
      <div className="space-y-2">
        {scenes.map((s, i) => (
          <div key={s.id} className="grid gap-2 rounded-xl border border-line p-3 md:grid-cols-[110px_1fr_1fr_1fr_120px]" data-testid="scene-row">
            <div className="space-y-1 text-xs">
              <p className="font-medium">Scena {s.sceneIndex}</p>
              <div className="flex items-center gap-1">
                <Input className="h-8 w-14 px-1.5 text-xs" type="number" step={0.5} min={0} value={s.startS ?? 0} onChange={(e) => set(s.id, { startS: Number(e.target.value) })} aria-label={`Start sceny ${s.sceneIndex}`} />–
                <Input className="h-8 w-14 px-1.5 text-xs" type="number" step={0.5} min={0} value={s.endS ?? 0} onChange={(e) => set(s.id, { endS: Number(e.target.value) })} aria-label={`Koniec sceny ${s.sceneIndex}`} />
              </div>
            </div>
            <Textarea rows={3} className="text-xs" value={s.spokenText ?? ""} onChange={(e) => set(s.id, { spokenText: e.target.value })} aria-label={`Słowa eksperta ${i + 1}`} placeholder="Słowa eksperta (lektor / teleprompter)" />
            <Textarea rows={3} className="text-xs" value={s.screenText ?? ""} onChange={(e) => set(s.id, { screenText: e.target.value })} aria-label={`Napis ${i + 1}`} placeholder="Napis na ekranie" />
            <Textarea rows={3} className="text-xs" value={s.visualBrief ?? ""} onChange={(e) => set(s.id, { visualBrief: e.target.value })} aria-label={`Kadr ${i + 1}`} placeholder="Kadr, obraz, B-roll, ruch" />
            <SceneCanvas className="w-full rounded border border-line" input={{ width: 270, height: 480, theme: data.theme, screenText: s.screenText || s.spokenText || "", visualBrief: s.visualBrief, sceneLabel: `Scena ${s.sceneIndex}`, logoUrl: data.logoUrl, photo: i === scenes.length - 1 ? null : photo(s), isCta: i === scenes.length - 1 && scenes.length > 1 }} />
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void save()} disabled={!dirty || !data.canEdit}>
            Zapisz scenariusz
          </Button>
          <Button variant="outline" onClick={() => download(`${data.project.slug}_${conceptId}.srt`, scenesToSrt(scenes))} data-testid="download-srt">
            <Download /> Napisy .srt
          </Button>
          <Button variant="outline" onClick={() => download(`${data.project.slug}_${conceptId}_teleprompter.txt`, teleprompterScript(draftV))}>
            Tekst do telepromptera
          </Button>
        </div>
      </div>
      {/* storyboard in one orientation */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">Storyboard</p>
          <NativeSelect className="h-8 w-40" value={orient} onChange={(e) => setOrient(e.target.value as typeof orient)} aria-label="Orientacja storyboardu">
            <option value="portrait">9:16{variantKeys.includes("portrait") ? "" : " (brak wariantu)"}</option>
            <option value="square">1:1{variantKeys.includes("square") ? "" : " (brak wariantu)"}</option>
            <option value="landscape">16:9{variantKeys.includes("landscape") ? "" : " (brak wariantu)"}</option>
          </NativeSelect>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {scenes.map((s, i) => (
            <div key={s.id} className="shrink-0 space-y-1" style={{ width: orient === "landscape" ? 260 : orient === "square" ? 170 : 130 }}>
              <SceneCanvas className="w-full rounded border border-line" input={{ width: f.width / 4, height: f.height / 4, theme: data.theme, screenText: s.screenText || s.spokenText || "", visualBrief: s.visualBrief, sceneLabel: `Scena ${s.sceneIndex}`, logoUrl: data.logoUrl, photo: i === scenes.length - 1 ? null : photo(s), isCta: i === scenes.length - 1 && scenes.length > 1 }} />
              <p className="text-[10px] text-muted">
                {s.startS}–{s.endS} s
              </p>
            </div>
          ))}
        </div>
      </div>
      {/* MP4 */}
      <div className="space-y-2 rounded-xl border border-line p-4" data-testid="video-export">
        <p className="text-sm font-medium">Animatik MP4 (16:9, 1:1, 9:16)</p>
        <p className="text-xs text-muted">
          Prawdziwy plik MP4 (H.264 + AAC, napisy jako ścieżka) złożony ze storyboardu: plansze scen w kolorach i fontach motywu, zdjęcie eksperta (tylko ze zgodą) i głos lektora ElevenLabs. To podgląd scenariusza w czasie — do kampanii nagraj film z ekspertem według shotlisty.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} className="h-4 w-4" /> Z głosem lektora
          </label>
          <Button
            onClick={async () => {
              try {
                setJob((await api<{ jobId: string }>(`${base}/videos/${conceptId}`, { method: "POST", json: { voice } })).jobId);
              } catch (e) {
                toast((e as Error).message, "err");
              }
            }}
            disabled={!!job || !data.canEdit}
            data-testid="render-video"
          >
            {job ? <Loader2 className="animate-spin" /> : <Film />} {job ? "Składam MP4…" : "Wygeneruj MP4 w 3 formatach"}
          </Button>
        </div>
        {files.length ? (
          <div className="grid gap-3 sm:grid-cols-3" data-testid="video-files">
            {files.map((x) => (
              <div key={x.url} className="space-y-1 text-xs">
                <video src={x.preview} controls className="max-h-64 w-full rounded bg-black" />
                <a href={x.url} className="inline-flex items-center gap-1 text-brand underline">
                  <Download className="h-3 w-3" /> {x.width}×{x.height} · {x.duration.toFixed(1)} s · {(x.bytes / 1024 / 1024).toFixed(1)} MB{x.voiced ? " · z głosem" : ""}
                </a>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
