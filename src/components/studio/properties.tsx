"use client";
import { useRef } from "react";
import { Trash2 } from "lucide-react";
import { DEFAULT_BUBBLE, type AudioClip, type AVClip, type CalloutOverlay, type EditorDocument, type FaceBubble, type ImageOverlay, type Overlay, type ShapeOverlay, type TextOverlay, type VideoOverlay, type ZoomEffect } from "@/lib/editor/types";
import { NarrationVoiceChanger } from "./narration";
import { clipEnd, deleteClip, docDuration } from "@/lib/editor/timeline";
import { ZOOM_PRESETS } from "@/lib/editor/zoom";
import { SUBTITLE_PRESETS } from "@/lib/editor/subtitles";
import { useStudio } from "./store";
import { ColorField, FontSelect, NumberField, Row, Section, Seg, Select, SButton, Slider, TextField, Toggle } from "./controls";
import { SAFE_ZONES } from "./preview";

export function Properties() {
  const doc = useStudio((s) => s.doc)!;
  const sel = useStudio((s) => s.selection);
  const apply = useStudio((s) => s.apply);

  if (sel?.kind === "overlay" && sel.ids.length === 1) {
    const o = doc.overlays.find((x) => x.id === sel.ids[0]);
    if (o) return <OverlayProps o={o} doc={doc} />;
  }
  if (sel?.kind === "overlay" && sel.ids.length > 1) {
    return (
      <Section title={`Zaznaczono ${sel.ids.length} elementy`}>
        <p className="text-[12.5px] text-studio-muted">Przeciągnij na podglądzie, aby przesunąć wszystkie naraz.</p>
        <SButton variant="danger" onClick={() => apply((d) => ({ ...d, overlays: d.overlays.filter((o) => !sel.ids.includes(o.id)) }))}>
          <Trash2 /> Usuń zaznaczone
        </SButton>
      </Section>
    );
  }
  if (sel?.kind === "clip") {
    const c = doc.clips.find((x) => x.id === sel.id);
    if (c) return <ClipProps c={c} />;
  }
  if (sel?.kind === "narration" || sel?.kind === "music") {
    const c = doc[sel.kind].find((x) => x.id === sel.id);
    if (c) return <AudioProps c={c} kind={sel.kind} />;
  }
  if (sel?.kind === "zoom") {
    const z = doc.zooms.find((x) => x.id === sel.id);
    if (z) return <ZoomProps z={z} />;
  }
  if (sel?.kind === "subtitles") return <SubtitleStyleProps />;
  return <CompositionProps />;
}

function patchOverlay<T extends Overlay>(id: string, patch: Partial<T>, key?: string) {
  useStudio.getState().apply((d) => ({ ...d, overlays: d.overlays.map((o) => (o.id === id ? ({ ...o, ...patch } as Overlay) : o)) }), key ?? `ovl:${id}:${Object.keys(patch).join(",")}`);
}

function TimingFields({ o, doc }: { o: Overlay; doc: EditorDocument }) {
  const dur = docDuration(doc);
  return (
    <>
      <Row label="Początek (s)">
        <NumberField value={o.start} min={0} onChange={(v) => patchOverlay(o.id, { start: Math.max(0, v) })} />
      </Row>
      <Row label="Koniec (s)">
        <span className="flex items-center gap-2">
          <NumberField value={o.end ?? dur} min={0} onChange={(v) => patchOverlay(o.id, { end: v >= dur ? null : Math.max(o.start + 0.1, v) })} />
          <SButton variant="ghost" onClick={() => patchOverlay(o.id, { end: null })} title="Do końca filmu">
            do końca
          </SButton>
        </span>
      </Row>
      <Row label="Animacja">
        <Select value={o.animation} onChange={(v) => patchOverlay(o.id, { animation: v as Overlay["animation"] })}>
          <option value="none">Brak</option>
          <option value="fade">Pojawienie</option>
          <option value="pop">Pop (odbicie)</option>
          <option value="slide">Wjazd z dołu</option>
          <option value="slideDown">Wjazd z góry</option>
          <option value="slideLeft">Wjazd z boku</option>
          <option value="zoom">Najazd (zoom)</option>
        </Select>
      </Row>
      <Row label="Krycie">
        <Slider value={o.opacity} min={0} max={1} step={0.01} onChange={(v) => patchOverlay(o.id, { opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
      </Row>
    </>
  );
}

function PositionFields({ o }: { o: Overlay }) {
  return (
    <>
      <Row label="Pozycja X">
        <Slider value={o.x} min={-0.2} max={1} step={0.005} onChange={(v) => patchOverlay(o.id, { x: v })} format={(v) => `${Math.round(v * 100)}%`} />
      </Row>
      <Row label="Pozycja Y">
        <Slider value={o.y} min={-0.1} max={1} step={0.005} onChange={(v) => patchOverlay(o.id, { y: v })} format={(v) => `${Math.round(v * 100)}%`} />
      </Row>
      <Row label="Szerokość">
        <Slider value={o.w} min={0.05} max={1.2} step={0.005} onChange={(v) => patchOverlay(o.id, { w: v })} format={(v) => `${Math.round(v * 100)}%`} />
      </Row>
      {o.kind !== "text" ? (
        <Row label="Wysokość">
          <Slider value={o.h} min={0.01} max={1} step={0.005} onChange={(v) => patchOverlay(o.id, { h: v })} format={(v) => `${Math.round(v * 100)}%`} />
        </Row>
      ) : null}
      <SButton variant="ghost" onClick={() => patchOverlay(o.id, { x: (1 - o.w) / 2 })}>
        Wyśrodkuj w poziomie
      </SButton>
    </>
  );
}

function OverlayProps({ o, doc }: { o: Overlay; doc: EditorDocument }) {
  const apply = useStudio((s) => s.apply);
  const remove = () => {
    apply((d) => deleteClip(d, o.id, false));
    useStudio.getState().select(null);
  };
  return (
    <div>
      <Section
        title={o.kind === "text" ? (o.role === "question" ? "Warstwa pytania" : "Tekst") : o.name}
        right={
          <span className="flex gap-1">
            <SButton variant="ghost" onClick={() => patchOverlay(o.id, { hidden: !o.hidden })}>
              {o.hidden ? "Pokaż" : "Ukryj"}
            </SButton>
            <SButton variant="ghost" onClick={remove} title="Usuń warstwę">
              <Trash2 />
            </SButton>
          </span>
        }
      >
        {o.kind === "text" ? <TextProps o={o} doc={doc} /> : null}
        {o.kind === "rect" || o.kind === "ellipse" || o.kind === "highlight" ? <ShapeProps o={o} doc={doc} /> : null}
        {o.kind === "callout" || o.kind === "lowerThird" ? <CalloutProps o={o} doc={doc} /> : null}
        {o.kind === "image" || o.kind === "logo" ? <ImageProps o={o} /> : null}
        {o.kind === "video" ? <VideoProps o={o} /> : null}
      </Section>
      <Section title="Pozycja i rozmiar">
        <PositionFields o={o} />
      </Section>
      <Section title="Czas i animacja">
        <TimingFields o={o} doc={doc} />
      </Section>
    </div>
  );
}

function TextProps({ o, doc }: { o: TextOverlay; doc: EditorDocument }) {
  const st = o.style;
  const ps = (p: Partial<TextOverlay["style"]>) => patchOverlay<TextOverlay>(o.id, { style: { ...st, ...p } }, `style:${o.id}:${Object.keys(p).join(",")}`);
  return (
    <>
      <textarea
        id="prop-text"
        className="min-h-20 w-full rounded-lg border border-studio-line bg-studio-3 p-2 text-[13px] text-studio-text outline-none focus:border-white/30"
        value={o.text}
        onChange={(e) => patchOverlay<TextOverlay>(o.id, { text: e.target.value }, `text:${o.id}`)}
        aria-label="Treść"
      />
      <Row label="Czcionka">
        <FontSelect value={st.fontFamily} onChange={(v) => ps({ fontFamily: v })} />
      </Row>
      <Row label="Rozmiar">
        <Slider value={st.fontSize} min={16} max={160} onChange={(v) => ps({ fontSize: v })} />
      </Row>
      <Row label="Grubość">
        <Select value={st.fontWeight} onChange={(v) => ps({ fontWeight: Number(v) })}>
          {[400, 500, 600, 700, 800].map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </Select>
      </Row>
      <Row label="Kolor">
        <ColorField value={st.color} onChange={(v) => ps({ color: v ?? "#FFFFFF" })} theme={doc.theme} />
      </Row>
      <Row label="Wyrównanie">
        <Seg value={st.align} onChange={(v) => ps({ align: v })} options={[["left", "Lewo"], ["center", "Środek"], ["right", "Prawo"]]} />
      </Row>
      <Row label="Interlinia">
        <Slider value={st.lineHeight} min={0.8} max={2} step={0.01} onChange={(v) => ps({ lineHeight: v })} />
      </Row>
      <Row label="Odstęp liter">
        <Slider value={st.letterSpacing} min={-4} max={20} step={0.5} onChange={(v) => ps({ letterSpacing: v })} />
      </Row>
      <Toggle label="Wielkie litery" checked={st.uppercase} onChange={(v) => ps({ uppercase: v })} />
      <Row label="Tło">
        <ColorField value={st.background} onChange={(v) => ps({ background: v })} theme={doc.theme} allowNone />
      </Row>
      {st.background ? (
        <>
          <Row label="Krycie tła">
            <Slider value={st.backgroundOpacity} min={0} max={1} step={0.01} onChange={(v) => ps({ backgroundOpacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
          </Row>
          <Row label="Margines">
            <Slider value={st.padding} min={0} max={80} onChange={(v) => ps({ padding: v })} />
          </Row>
          <Row label="Zaokrąglenie">
            <Slider value={st.radius} min={0} max={80} onChange={(v) => ps({ radius: v })} />
          </Row>
        </>
      ) : null}
      <Row label="Cień">
        <Slider value={st.shadow} min={0} max={60} onChange={(v) => ps({ shadow: v })} />
      </Row>
    </>
  );
}

function ShapeProps({ o, doc }: { o: ShapeOverlay; doc: EditorDocument }) {
  return (
    <>
      <Row label="Wypełnienie">
        <ColorField value={o.fill} onChange={(v) => patchOverlay<ShapeOverlay>(o.id, { fill: v })} theme={doc.theme} allowNone />
      </Row>
      <Row label="Obrys">
        <ColorField value={o.stroke} onChange={(v) => patchOverlay<ShapeOverlay>(o.id, { stroke: v })} theme={doc.theme} allowNone />
      </Row>
      <Row label="Grubość obrysu">
        <Slider value={o.strokeWidth} min={0} max={24} onChange={(v) => patchOverlay<ShapeOverlay>(o.id, { strokeWidth: v })} />
      </Row>
      {o.kind !== "ellipse" ? (
        <Row label="Zaokrąglenie">
          <Slider value={o.radius} min={0} max={120} onChange={(v) => patchOverlay<ShapeOverlay>(o.id, { radius: v })} />
        </Row>
      ) : null}
    </>
  );
}

function CalloutProps({ o, doc }: { o: CalloutOverlay; doc: EditorDocument }) {
  return (
    <>
      <Row label="Tytuł">
        <TextField value={o.title} onChange={(e) => patchOverlay<CalloutOverlay>(o.id, { title: e.target.value }, `t:${o.id}`)} />
      </Row>
      <Row label="Podtytuł">
        <TextField value={o.subtitle} onChange={(e) => patchOverlay<CalloutOverlay>(o.id, { subtitle: e.target.value }, `s:${o.id}`)} />
      </Row>
      <Row label="Tło">
        <ColorField value={o.fill} onChange={(v) => patchOverlay<CalloutOverlay>(o.id, { fill: v ?? "$primary" })} theme={doc.theme} />
      </Row>
      <Row label="Akcent">
        <ColorField value={o.accent} onChange={(v) => patchOverlay<CalloutOverlay>(o.id, { accent: v ?? "$accent" })} theme={doc.theme} />
      </Row>
      <Row label="Tekst">
        <ColorField value={o.textColor} onChange={(v) => patchOverlay<CalloutOverlay>(o.id, { textColor: v ?? "$text" })} theme={doc.theme} />
      </Row>
      <Row label="Czcionka">
        <FontSelect value={o.fontFamily} onChange={(v) => patchOverlay<CalloutOverlay>(o.id, { fontFamily: v })} />
      </Row>
      <Row label="Rozmiar tytułu">
        <Slider value={o.titleSize ?? Math.round(Math.min(o.h * 1920 * 0.4, 46))} min={16} max={140} onChange={(v) => patchOverlay<CalloutOverlay>(o.id, { titleSize: v })} />
      </Row>
      <Row label="Rozmiar podtytułu">
        <Slider value={o.subtitleSize ?? Math.round(Math.min(o.h * 1920 * 0.26, 30))} min={12} max={100} onChange={(v) => patchOverlay<CalloutOverlay>(o.id, { subtitleSize: v })} />
      </Row>
      <p className="text-[11.5px] text-studio-muted">Belka sama się powiększa, gdy tekst jest większy.</p>
    </>
  );
}

function VideoProps({ o }: { o: VideoOverlay }) {
  return (
    <>
      <Row label="Dopasowanie">
        <Seg value={o.fit} onChange={(v) => patchOverlay<VideoOverlay>(o.id, { fit: v })} options={[["contain", "Zmieść"], ["cover", "Wypełnij"]]} />
      </Row>
      <Toggle label="Zapętlaj" checked={o.loop} onChange={(v) => patchOverlay<VideoOverlay>(o.id, { loop: v })} />
      <Row label="Dźwięk">
        <Slider value={o.volume} min={0} max={1.5} step={0.01} onChange={(v) => patchOverlay<VideoOverlay>(o.id, { volume: v })} format={(v) => (v <= 0 ? "wył." : `${Math.round(v * 100)}%`)} />
      </Row>
      <Row label="Start w pliku (s)">
        <NumberField value={o.sourceIn} min={0} onChange={(v) => patchOverlay<VideoOverlay>(o.id, { sourceIn: Math.max(0, v) })} />
      </Row>
      <Row label="Zaokrąglenie">
        <Slider value={o.radius} min={0} max={120} onChange={(v) => patchOverlay<VideoOverlay>(o.id, { radius: v })} />
      </Row>
    </>
  );
}

function ImageProps({ o }: { o: ImageOverlay }) {
  const apply = useStudio((s) => s.apply);
  const b = o.bubble;
  const setB = (p: Partial<FaceBubble>, key: string) => patchOverlay<ImageOverlay>(o.id, { bubble: { ...(b ?? DEFAULT_BUBBLE), ...p } }, `ovl:${o.id}:bubble:${key}`);
  const fullFrame = o.kind === "image" && o.w >= 0.95 && o.h >= 0.95;
  const corners: Array<[string, number, number]> = [
    ["↖", 0.2, 0.25],
    ["↗", 0.8, 0.25],
    ["↙", 0.2, 0.62],
    ["↘", 0.72, 0.62],
  ];
  return (
    <>
      <Row label="Dopasowanie">
        <Seg value={o.fit} onChange={(v) => patchOverlay<ImageOverlay>(o.id, { fit: v })} options={[["contain", "Zmieść"], ["cover", "Wypełnij"]]} />
      </Row>
      {o.kind === "image" ? (
        <div className="space-y-2 rounded-lg border border-studio-line p-2.5" data-testid="bubble-props">
          <label className="flex items-center justify-between gap-2 text-[12.5px]">
            <span>Twarz eksperta w kółku</span>
            <input type="checkbox" checked={!!b} onChange={(e) => patchOverlay<ImageOverlay>(o.id, { bubble: e.target.checked ? { ...DEFAULT_BUBBLE } : undefined })} aria-label="Twarz eksperta w kółku" />
          </label>
          {b ? (
            <>
              <p className="text-[11px] leading-snug text-studio-muted">Przeciągnij kółko na podglądzie (albo kropkę poniżej) w dowolne miejsce, a białym uchwytem zmień jego wielkość.</p>
              <BubblePad b={b} onMove={(x, y) => setB({ x, y }, "pos")} />
              <Row label="Szybko">
                <div className="flex gap-1">
                  {corners.map(([label, x, y]) => (
                    <SButton key={label} variant="ghost" className="h-7 w-8 px-0" onClick={() => setB({ x, y }, "pos")} aria-label={`Kółko ${label}`}>
                      {label}
                    </SButton>
                  ))}
                </div>
              </Row>
              <Row label={`Wielkość: ${Math.round(b.size * 100)}%`}>
                <Slider value={Math.round(b.size * 100)} min={10} max={90} onChange={(v) => setB({ size: v / 100 }, "size")} />
              </Row>
              <Row label={`Przybliżenie twarzy: ${(b.zoom ?? 1.25).toFixed(1)}×`}>
                <Slider value={Math.round((b.zoom ?? 1.25) * 10)} min={6} max={30} onChange={(v) => setB({ zoom: v / 10 }, "zoom")} />
              </Row>
              <Row label="Wysokość twarzy w kadrze">
                <Slider value={Math.round((b.fy ?? 0.3) * 100)} min={10} max={80} onChange={(v) => setB({ fy: v / 100 }, "fy")} />
              </Row>
              {fullFrame ? (
                <SButton
                  variant="ghost"
                  className="h-7 w-full text-[11.5px]"
                  onClick={() =>
                    apply((d) => ({ ...d, overlays: d.overlays.map((x) => (x.kind === "image" && x.w >= 0.95 && x.h >= 0.95 ? { ...x, bubble: { ...b } } : x)) }), "bubble:all")
                  }
                >
                  Użyj tego kółka na wszystkich grafikach pełnoekranowych
                </SButton>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
      {o.kind === "logo" && !o.assetId ? <p className="text-[12px] text-studio-muted">Logo pochodzi z motywu projektu — zmiana logo w motywie zaktualizuje wszystkie filmy.</p> : null}
    </>
  );
}

function ClipProps({ c }: { c: AVClip }) {
  const apply = useStudio((s) => s.apply);
  const patch = (p: Partial<AVClip>, key: string) => apply((d) => ({ ...d, clips: d.clips.map((x) => (x.id === c.id ? { ...x, ...p } : x)) }), `clip:${c.id}:${key}`);
  const framing = (p: Partial<AVClip["framing"]>) => patch({ framing: { ...c.framing, ...p } }, `framing:${Object.keys(p).join(",")}`);
  return (
    <div>
      <Section title="Klip wideo + głos eksperta">
        <p className="text-[12px] text-studio-muted">
          Źródło: {c.sourceIn.toFixed(2)}–{c.sourceOut.toFixed(2)} s · na osi od {c.start.toFixed(2)} s. Wideo i dźwięk są połączone — cięcia zawsze zachowują synchronizację.
        </p>
        <Row label="Głośność">
          <Slider value={c.volume} min={0} max={2} step={0.01} onChange={(v) => patch({ volume: v }, "vol")} format={(v) => `${Math.round(v * 100)}%`} />
        </Row>
        <Toggle label="Wycisz dźwięk klipu" checked={c.muted} onChange={(v) => patch({ muted: v }, "mute")} />
        <Row label="Etykieta">
          <TextField value={c.label ?? ""} onChange={(e) => patch({ label: e.target.value }, "label")} />
        </Row>
      </Section>
      <Section title="Kadrowanie">
        <Row label="Powiększenie">
          <Slider value={c.framing.scale} min={1} max={2} step={0.01} onChange={(v) => framing({ scale: v })} format={(v) => `${Math.round(v * 100)}%`} />
        </Row>
        <Row label="Środek X">
          <Slider value={c.framing.cx} min={0} max={1} step={0.005} onChange={(v) => framing({ cx: v })} format={(v) => `${Math.round(v * 100)}%`} />
        </Row>
        <Row label="Środek Y">
          <Slider value={c.framing.cy} min={0} max={1} step={0.005} onChange={(v) => framing({ cy: v })} format={(v) => `${Math.round(v * 100)}%`} />
        </Row>
        <p className="text-[11.5px] text-studio-muted">Kadr zawsze wypełnia cały ekran — bez czarnych pasów.</p>
      </Section>
    </div>
  );
}

function AudioProps({ c, kind }: { c: AudioClip; kind: "narration" | "music" }) {
  const apply = useStudio((s) => s.apply);
  const patch = (p: Partial<AudioClip>, key: string) => apply((d) => ({ ...d, [kind]: d[kind].map((x) => (x.id === c.id ? { ...x, ...p } : x)) }), `${kind}:${c.id}:${key}`);
  return (
    <Section
      title={kind === "narration" ? "Lektor ElevenLabs" : "Muzyka w tle"}
      right={
        <SButton
          variant="ghost"
          onClick={() => {
            apply((d) => deleteClip(d, c.id, false));
            useStudio.getState().select(null);
          }}
        >
          <Trash2 />
        </SButton>
      }
    >
      <Row label="Głośność">
        <Slider value={c.volume} min={0} max={2} step={0.01} onChange={(v) => patch({ volume: v }, "vol")} format={(v) => `${Math.round(v * 100)}%`} />
      </Row>
      <Toggle label="Wycisz" checked={c.muted} onChange={(v) => patch({ muted: v }, "mute")} />
      <Row label="Start (s)">
        <NumberField value={c.start} min={0} onChange={(v) => patch({ start: Math.max(0, v) }, "start")} />
      </Row>
      <Row label="Wejście (s)">
        <Slider value={c.fadeIn} min={0} max={5} step={0.1} onChange={(v) => patch({ fadeIn: v }, "fi")} />
      </Row>
      <Row label="Wyciszenie (s)">
        <Slider value={c.fadeOut} min={0} max={5} step={0.1} onChange={(v) => patch({ fadeOut: v }, "fo")} />
      </Row>
      <p className="text-[11.5px] text-studio-muted">
        Na osi: {c.start.toFixed(2)}–{clipEnd(c).toFixed(2)} s. Przeciągnij krawędzie na osi czasu, aby przyciąć.
      </p>
      {kind === "narration" ? (
        <div className="border-t border-studio-line pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-studio-muted">Zmień lektora</p>
          <NarrationVoiceChanger questionText={useStudio.getState().doc?.meta.questionText} />
        </div>
      ) : null}
    </Section>
  );
}

function ZoomProps({ z }: { z: ZoomEffect }) {
  const apply = useStudio((s) => s.apply);
  const patch = (p: Partial<ZoomEffect>, key: string) => apply((d) => ({ ...d, zooms: d.zooms.map((x) => (x.id === z.id ? { ...x, ...p } : x)) }), `zoom:${z.id}:${key}`);
  return (
    <Section
      title="Efekt zbliżenia"
      right={
        <SButton
          variant="ghost"
          onClick={() => {
            apply((d) => ({ ...d, zooms: d.zooms.filter((x) => x.id !== z.id) }));
            useStudio.getState().select(null);
          }}
        >
          <Trash2 />
        </SButton>
      }
    >
      {z.suggested ? (
        <div className="flex gap-2">
          <SButton variant="primary" onClick={() => patch({ suggested: false }, "accept")}>
            Akceptuj
          </SButton>
          <SButton
            onClick={() => {
              apply((d) => ({ ...d, zooms: d.zooms.filter((x) => x.id !== z.id) }));
              useStudio.getState().select(null);
            }}
          >
            Odrzuć
          </SButton>
        </div>
      ) : null}
      <Row label="Typ">
        <Select
          value={z.type}
          onChange={(v) => {
            const p = ZOOM_PRESETS[v as ZoomEffect["type"]];
            patch({ type: v as ZoomEffect["type"], fromScale: p.from, toScale: p.to, easing: p.easing }, "type");
          }}
        >
          {Object.entries(ZOOM_PRESETS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
      </Row>
      <Row label="Początek (s)">
        <NumberField value={z.start} onChange={(v) => patch({ start: Math.max(0, Math.min(v, z.end - 0.2)) }, "start")} />
      </Row>
      <Row label="Koniec (s)">
        <NumberField value={z.end} onChange={(v) => patch({ end: Math.max(z.start + 0.2, v) }, "end")} />
      </Row>
      <Row label="Skala od">
        <Slider value={z.fromScale} min={1} max={1.5} step={0.01} onChange={(v) => patch({ fromScale: v }, "from")} format={(v) => `${Math.round(v * 100)}%`} />
      </Row>
      <Row label="Skala do">
        <Slider value={z.toScale} min={1} max={1.5} step={0.01} onChange={(v) => patch({ toScale: v }, "to")} format={(v) => `${Math.round(v * 100)}%`} />
      </Row>
      <Row label="Krzywa">
        <Select value={z.easing} onChange={(v) => patch({ easing: v as ZoomEffect["easing"] }, "ease")}>
          <option value="easeInOut">Płynna (ease-in-out)</option>
          <option value="easeOut">Hamująca (ease-out)</option>
          <option value="easeIn">Przyspieszająca (ease-in)</option>
          <option value="linear">Liniowa</option>
          <option value="step">Skok (natychmiast)</option>
        </Select>
      </Row>
      <Row label="Środek X">
        <Slider value={z.cx} min={0} max={1} step={0.005} onChange={(v) => patch({ cx: v }, "cx")} format={(v) => `${Math.round(v * 100)}%`} />
      </Row>
      <Row label="Środek Y">
        <Slider value={z.cy} min={0} max={1} step={0.005} onChange={(v) => patch({ cy: v }, "cy")} format={(v) => `${Math.round(v * 100)}%`} />
      </Row>
      <p className="text-[11.5px] text-studio-muted">Środek kadru ustawiasz ręcznie — kadr jest zawsze przycinany tak, aby nie powstały czarne pasy.</p>
    </Section>
  );
}

export function SubtitleStyleProps() {
  const doc = useStudio((s) => s.doc)!;
  const apply = useStudio((s) => s.apply);
  const st = doc.subtitles.style;
  const ps = (p: Partial<typeof st>) => apply((d) => ({ ...d, subtitles: { ...d.subtitles, style: { ...d.subtitles.style, ...p } } }), `subs:${Object.keys(p).join(",")}`);
  return (
    <div>
      <Section title="Napisy">
        <Toggle label="Pokaż napisy" checked={doc.subtitles.enabled} onChange={(v) => apply((d) => ({ ...d, subtitles: { ...d.subtitles, enabled: v } }))} />
        <Row label="Styl">
          <Select
            value={doc.subtitles.preset}
            onChange={(v) => apply((d) => ({ ...d, subtitles: { ...d.subtitles, preset: v as typeof d.subtitles.preset, style: { ...SUBTITLE_PRESETS[v as keyof typeof SUBTITLE_PRESETS].style, y: d.subtitles.style.y } } }))}
          >
            {Object.entries(SUBTITLE_PRESETS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Czcionka">
          <FontSelect value={st.fontFamily} onChange={(v) => ps({ fontFamily: v })} />
        </Row>
        <Row label="Rozmiar">
          <Slider value={st.fontSize} min={24} max={120} onChange={(v) => ps({ fontSize: v })} />
        </Row>
        <Row label="Grubość">
          <Select value={st.fontWeight} onChange={(v) => ps({ fontWeight: Number(v) })}>
            {[400, 500, 600, 700, 800].map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Litery">
          <Seg value={st.case} onChange={(v) => ps({ case: v })} options={[["normal", "Aa"], ["upper", "AA"], ["lower", "aa"]]} />
        </Row>
        <Row label="Kolor">
          <ColorField value={st.color} onChange={(v) => ps({ color: v ?? "#FFFFFF" })} theme={doc.theme} />
        </Row>
        <Row label="Wyróżnienie">
          <Seg value={st.highlightMode} onChange={(v) => ps({ highlightMode: v })} options={[["none", "Brak"], ["color", "Kolor"], ["box", "Ramka"]]} />
        </Row>
        <Row label="Kolor aktywny">
          <ColorField value={st.highlightColor} onChange={(v) => ps({ highlightColor: v ?? "$highlight" })} theme={doc.theme} />
        </Row>
        <Row label="Animacja">
          <Select value={st.animation} onChange={(v) => ps({ animation: v as typeof st.animation })}>
            <option value="none">Brak</option>
            <option value="fade">Pojawienie</option>
            <option value="pop">Pop</option>
          </Select>
        </Row>
        <Row label="Pozycja Y">
          <Slider value={st.y} min={0.1} max={0.92} step={0.005} onChange={(v) => ps({ y: v })} format={(v) => `${Math.round(v * 100)}%`} />
        </Row>
        <Row label="Szerokość">
          <Slider value={st.maxWidth} min={0.4} max={0.95} step={0.01} onChange={(v) => ps({ maxWidth: v })} format={(v) => `${Math.round(v * 100)}%`} />
        </Row>
        <Row label="Obrys">
          <Slider value={st.stroke} min={0} max={14} step={0.5} onChange={(v) => ps({ stroke: v })} />
        </Row>
        <Row label="Cień">
          <Slider value={st.shadow} min={0} max={40} onChange={(v) => ps({ shadow: v })} />
        </Row>
        <Row label="Tło">
          <ColorField value={st.background} onChange={(v) => ps({ background: v, backgroundOpacity: v && !st.backgroundOpacity ? 0.6 : st.backgroundOpacity })} theme={doc.theme} allowNone />
        </Row>
        {st.background ? (
          <Row label="Krycie tła">
            <Slider value={st.backgroundOpacity} min={0} max={1} step={0.01} onChange={(v) => ps({ backgroundOpacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
          </Row>
        ) : null}
        <p className="text-[11.5px] text-studio-muted">Przeciągnij napisy na podglądzie, aby zmienić ich położenie. Treść edytujesz w panelu „Napisy” po lewej.</p>
      </Section>
    </div>
  );
}

function CompositionProps() {
  const doc = useStudio((s) => s.doc)!;
  const apply = useStudio((s) => s.apply);
  return (
    <div>
      <Section title="Kompozycja">
        <p className="text-[12.5px] text-studio-muted">
          {doc.width} × {doc.height} · {doc.fps} kl./s · {docDuration(doc).toFixed(1)} s
        </p>
        <Row label="Strefy UI">
          <Select value={doc.meta.showSafeArea ?? "tiktok"} onChange={(v) => apply((d) => ({ ...d, meta: { ...d.meta, showSafeArea: v as "tiktok" } }))}>
            {Object.entries(SAFE_ZONES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
            <option value="none">Ukryj</option>
          </Select>
        </Row>
        <p className="text-[11.5px] text-studio-muted">Strefy pokazują, gdzie aplikacje nakładają swoje przyciski. Nie pojawiają się w eksporcie.</p>
      </Section>
      <Section title="Motyw">
        <div className="flex flex-wrap gap-1.5">
          {(["primary", "accent", "highlight", "secondary", "text", "background"] as const).map((k) => (
            <span key={k} title={k} className="h-6 w-6 rounded-md ring-1 ring-white/10" style={{ background: doc.theme[k] }} />
          ))}
        </div>
        <p className="text-[12px] text-studio-muted">
          {doc.theme.name} · {doc.theme.questionFont} / {doc.theme.subtitleFont}
        </p>
        <p className="text-[11.5px] text-studio-muted">Kolory i czcionki zmienisz w panelu „Motyw” — zmiany obejmują pytanie, napisy, belki i dekoracje we wszystkich filmach projektu.</p>
      </Section>
      <Section title="Wskazówka">
        <p className="text-[12px] leading-relaxed text-studio-muted">Kliknij element na podglądzie lub na osi czasu, aby edytować jego właściwości. Skróty: Spacja — odtwarzanie, S — podziel, Delete — usuń, Shift+Delete — usuń z zamknięciem luki, ⌘/Ctrl+Z — cofnij.</p>
      </Section>
    </div>
  );
}

/** Mini frame: drag the dot to put the face bubble anywhere. */
function BubblePad({ b, onMove }: { b: FaceBubble; onMove: (x: number, y: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const W = 90;
  const H = 160;
  const d = Math.max(8, b.size * W);
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const half = b.size / 2;
    const halfY = (half * 1080) / 1920;
    onMove(Math.min(1 - half, Math.max(half, (e.clientX - r.left) / r.width)), Math.min(1 - halfY, Math.max(halfY, (e.clientY - r.top) / r.height)));
  };
  return (
    <div className="flex items-center gap-3">
      <div
        ref={ref}
        className="relative shrink-0 cursor-crosshair touch-none rounded-md border border-studio-line bg-studio-3"
        style={{ width: W, height: H }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          at(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons) at(e);
        }}
        data-testid="bubble-pad"
        aria-label="Położenie kółka"
      >
        <span className="pointer-events-none absolute rounded-full border-2 border-sky-400 bg-sky-400/30" style={{ width: d, height: d, left: b.x * W - d / 2, top: b.y * H - d / 2 }} />
      </div>
      <p className="text-[11px] leading-snug text-studio-muted">
        X {Math.round(b.x * 100)}% · Y {Math.round(b.y * 100)}%
      </p>
    </div>
  );
}
