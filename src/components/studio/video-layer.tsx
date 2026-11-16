"use client";
import { useRef, useState } from "react";
import { Film, Loader2, Trash2, Volume2, VolumeX } from "lucide-react";
import type { AssetInfo, VideoOverlay } from "@/lib/editor/types";
import { docDuration } from "@/lib/editor/timeline";
import { uid } from "@/lib/editor/id";
import { cn } from "@/lib/utils";
import { DropZone } from "@/components/drop-zone";
import { useStudio } from "./store";
import { Section, Seg, SButton, Toggle } from "./controls";

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/**
 * "Wideo" tab: an own video (e.g. an explainer) as an extra layer over the recording, placed at the
 * playhead. Its sound is off by default, so the expert keeps talking over the picture.
 */
export function VideoLayerPanel({ onUpload }: { onUpload: (f: File) => Promise<AssetInfo | null> }) {
  const time = useStudio((s) => s.time);
  const doc = useStudio((s) => s.doc)!;
  const selection = useStudio((s) => s.selection);
  const selected = selection?.kind === "overlay" ? selection.ids : [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [place, setPlace] = useState<"full" | "window">("full");
  const [sound, setSound] = useState(false);
  const layers = doc.overlays.filter((o): o is VideoOverlay => o.kind === "video" && !o.id.startsWith("basket_"));
  const patch = (id: string, p: Partial<VideoOverlay>) => useStudio.getState().apply((d) => ({ ...d, overlays: d.overlays.map((o) => (o.id === id ? ({ ...o, ...p } as typeof o) : o)) }));

  const placeFile = async (f: File) => {
    if (!f.type.startsWith("video/")) return;
    setUploading(true);
    try {
      const a = await onUpload(f);
      if (!a || a.kind !== "OVERLAY_VIDEO") return;
      const d = useStudio.getState().doc!;
      const start = Math.max(0, useStudio.getState().time);
      const end = Math.min(Math.max(docDuration(d), start + 1), start + Math.max(1, a.durationSec ?? 5));
      let box = { x: 0, y: 0, w: 1, h: 1 };
      if (place === "window") {
        const w = 0.6;
        const ar = a.width && a.height ? a.width / a.height : 9 / 16;
        const h = Math.min(0.6, (w * d.width) / ar / d.height);
        box = { x: (1 - w) / 2, y: 0.4 - h / 2, w, h };
      }
      const o: VideoOverlay = { id: uid("ovl"), name: f.name, kind: "video", assetId: a.id, start, end, opacity: 1, animation: "fade", fit: place === "full" ? "cover" : "contain", sourceIn: 0, loop: false, volume: sound ? 1 : 0, radius: place === "full" ? 0 : 24, ...box };
      useStudio.getState().apply((dd) => ({ ...dd, overlays: [...dd.overlays, o] }));
      useStudio.getState().select({ kind: "overlay", ids: [o.id] });
    } finally {
      setUploading(false);
    }
  };

  return (
    <DropZone dark accept="video/mp4,video/quicktime,video/webm" multiple={false} label="Upuść wideo - trafi na oś czasu w bieżącym miejscu" onFiles={(fs) => void placeFile(fs[0])} data-testid="video-layer-drop">
      <Section title="Dodatkowa warstwa wideo">
        <p className="mb-2 text-[11.5px] leading-snug text-studio-muted">Własne wideo (np. explainer) jako warstwa nad nagraniem. Zaczyna się w miejscu, w którym stoi głowica ({clock(time)}), i trwa tyle, ile plik - najwyżej do końca reelsa.</p>
        <div className="space-y-2">
          <Seg value={place} onChange={(v) => setPlace(v as "full" | "window")} options={[["full", "Cały kadr"], ["window", "Okno"]]} />
          <div data-testid="video-layer-sound">
            <Toggle label="Dźwięk z wideo" checked={sound} onChange={setSound} />
          </div>
          <p className="text-[11px] leading-snug text-studio-muted">{sound ? "Dźwięk wideo zagra razem z głosem eksperta." : "Wideo bez dźwięku: słychać tylko eksperta."}</p>
          <SButton variant="primary" className="w-full justify-center" disabled={uploading} onClick={() => fileRef.current?.click()} data-testid="video-layer-add">
            {uploading ? <Loader2 className="animate-spin" /> : <Film />} {uploading ? "Wysyłanie…" : "Wgraj wideo (MP4, MOV, WEBM)"}
          </SButton>
          <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" data-testid="video-layer-input" onChange={(e) => (e.target.files?.[0] ? void placeFile(e.target.files[0]) : null, (e.target.value = ""))} />
          <p className="text-[11px] text-studio-muted">Do 300 MB. Położenie, czas i głośność zmienisz potem po prawej i na osi czasu.</p>
        </div>
      </Section>
      <Section title={`Warstwy wideo w reelsie (${layers.length})`}>
        {layers.length ? (
          <ul className="space-y-1" data-testid="video-layer-list">
            {layers.map((o) => (
              <li key={o.id} data-testid="video-layer-row" data-muted={o.volume <= 0} className={cn("flex items-center gap-1 rounded-lg border px-2 py-1.5", selected.includes(o.id) ? "border-white/40 bg-studio-3" : "border-studio-line")}>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => (useStudio.getState().select({ kind: "overlay", ids: [o.id] }), useStudio.getState().setTime(o.start))}>
                  <span className="block truncate text-[12px] text-studio-text">{o.name}</span>
                  <span className="block text-[10.5px] text-studio-muted">
                    {clock(o.start)} - {clock(o.end ?? docDuration(doc))} · {o.volume > 0 ? `dźwięk ${Math.round(o.volume * 100)}%` : "bez dźwięku"}
                  </span>
                </button>
                <button type="button" title={o.volume > 0 ? "Wyłącz dźwięk tego wideo" : "Włącz dźwięk tego wideo"} aria-label={o.volume > 0 ? "Wyłącz dźwięk wideo" : "Włącz dźwięk wideo"} data-testid="video-layer-mute" className="rounded-md p-1.5 text-studio-muted hover:bg-studio-3 hover:text-studio-text" onClick={() => patch(o.id, { volume: o.volume > 0 ? 0 : 1 })}>
                  {o.volume > 0 ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </button>
                <button type="button" title="Usuń to wideo" aria-label="Usuń warstwę wideo" data-testid="video-layer-remove" className="rounded-md p-1.5 text-studio-muted hover:bg-studio-3 hover:text-rose-300" onClick={() => useStudio.getState().apply((d) => ({ ...d, overlays: d.overlays.filter((x) => x.id !== o.id) }))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11.5px] text-studio-muted">Brak. Wgraj wideo powyżej albo upuść plik na ten panel.</p>
        )}
      </Section>
    </DropZone>
  );
}
