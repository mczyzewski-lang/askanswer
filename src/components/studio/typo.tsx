"use client";
import { useEffect, useRef } from "react";
import type { EditorDocument, Overlay, ThemeTokens, TypoOverlay } from "@/lib/editor/types";
import { defaultMotif, drawTypo, TYPO_PRESETS } from "@/lib/render/typo";
import { uid } from "@/lib/editor/id";
import { ensureFontsLoaded } from "@/lib/client/fonts";
import { useStudio } from "./store";
import { ColorField, Row, Section, Seg, Select, Slider, TextField, Toggle } from "./controls";

type Preset = (typeof TYPO_PRESETS)[number];

/** a new typo layer at the playhead (the transition covers the whole frame) */
function makeTypo(p: Preset, time: number, theme: ThemeTokens): TypoOverlay {
  return { id: uid("ovl"), name: p.label, kind: "typo", preset: p.key, text: p.sample, ...(p.sub ? { sub: p.sub } : {}), size: p.size, start: Math.max(0, time), end: time + p.seconds, opacity: 1, animation: "none", plate: !!p.plate, motif: defaultMotif(theme.name), ...p.box };
}

/** the preset playing in a loop, in the project's colours */
function TypoThumb({ p, theme }: { p: Preset; theme: ThemeTokens }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let raf = 0;
    let live = true;
    const W = 1080;
    const H = p.key === "stairWipe" ? 1080 : 620;
    const k = 0.3;
    c.width = Math.round(W * k);
    c.height = Math.round(H * k);
    const doc = { width: W, height: H, theme } as unknown as EditorDocument;
    const box = p.key === "stairWipe" ? p.box : p.key === "stamp" ? { x: 0.12, y: 0.4, w: 0.76, h: 0.2 } : { x: 0.06, y: 0.14, w: 0.88, h: 0.72 };
    const o = { ...makeTypo(p, 0, theme), ...box, start: 0.25, end: 0.25 + p.seconds, size: p.key === "stairWipe" ? p.size * 0.8 : p.size } as TypoOverlay;
    const loop = p.seconds + 0.9;
    const t0 = performance.now();
    const frame = (now: number) => {
      if (!live) return;
      const g = c.getContext("2d")!;
      g.setTransform(k, 0, 0, k, 0, 0);
      // a neutral "recording" behind
      const gr = g.createLinearGradient(0, 0, W, H);
      gr.addColorStop(0, "#6f6a66");
      gr.addColorStop(1, "#3b4148");
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      const t = ((now - t0) / 1000) % loop;
      if (t >= o.start && t < (o.end ?? loop)) drawTypo(g, doc, o, t, loop, false);
      raf = requestAnimationFrame(frame);
    };
    void ensureFontsLoaded().then(() => {
      if (live) raf = requestAnimationFrame(frame);
    });
    return () => {
      live = false;
      cancelAnimationFrame(raf);
    };
  }, [p, theme]);
  return <canvas ref={ref} className="w-full rounded-md" style={{ aspectRatio: p.key === "stairWipe" ? "1 / 1" : "1080 / 620" }} />;
}

/** Studio → Typo animacje: motion presets in the theme's colours, added at the playhead */
export function TypoPanel() {
  const time = useStudio((s) => s.time);
  const theme = useStudio((s) => s.doc!.theme);
  const add = (o: Overlay) => {
    useStudio.getState().apply((d) => ({ ...d, overlays: [...d.overlays, o] }));
    useStudio.getState().select({ kind: "overlay", ids: [o.id] });
  };
  return (
    <Section title="Typo animacje">
      <p className="mb-3 text-[12px] text-studio-muted">
        Animowane napisy i przejścia w kolorach motywu{defaultMotif(theme.name) === "stairs" ? ", ze schodkami z logo" : ""}. Kliknij, żeby dodać w miejscu głowicy; tekst zmienisz we właściwościach. Słowo w *gwiazdkach* dostaje kolor akcentu, nowa linia lub „|” zaczyna kolejną linię / krok.
      </p>
      <div className="grid grid-cols-1 gap-2.5" data-testid="typo-presets">
        {TYPO_PRESETS.map((p) => (
          <button key={p.key} type="button" className="rounded-lg border border-studio-line p-2 text-left hover:bg-studio-3" onClick={() => add(makeTypo(p, time, theme))} data-testid={`typo-add-${p.key}`}>
            <TypoThumb p={p} theme={theme} />
            <span className="mt-1.5 block text-[12.5px] font-semibold text-studio-text">{p.label}</span>
            <span className="block text-[11.5px] text-studio-muted">{p.hint}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11.5px] text-studio-muted">Przejście schodkowe ustaw tak, żeby jego środek wypadał na cięciu: kadr zmienia się, gdy ekran jest zasłonięty.</p>
    </Section>
  );
}

function patch(id: string, p: Partial<TypoOverlay>, key?: string) {
  useStudio.getState().apply((d) => ({ ...d, overlays: d.overlays.map((o) => (o.id === id ? ({ ...o, ...p } as Overlay) : o)) }), key ?? `typo:${id}:${Object.keys(p).join(",")}`);
}

/** properties of a typo layer */
export function TypoProps({ o, doc }: { o: TypoOverlay; doc: EditorDocument }) {
  const titled = o.preset === "stairTitle" || o.preset === "stairWipe";
  return (
    <>
      <Row label="Animacja">
        <Select value={o.preset} onChange={(v) => patch(o.id, { preset: v as TypoOverlay["preset"], name: TYPO_PRESETS.find((p) => p.key === v)?.label ?? o.name })} aria-label="Preset typo">
          {TYPO_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </Select>
      </Row>
      <label className="block text-[12.5px] text-studio-text">
        <span className="mb-1 block text-studio-muted">Tekst (*akcent*, nowa linia lub | = kolejna linia / krok)</span>
        <textarea
          value={o.text}
          rows={3}
          aria-label="Tekst typo"
          onChange={(e) => patch(o.id, { text: e.target.value }, `typo-t:${o.id}`)}
          className="w-full rounded-lg border border-studio-line bg-studio-3 px-2 py-1.5 text-[12.5px] text-studio-text outline-none focus:border-white/30"
        />
      </label>
      {titled ? (
        <Row label="Druga linia">
          <TextField value={o.sub ?? ""} aria-label="Druga linia typo" onChange={(e) => patch(o.id, { sub: e.target.value }, `typo-s:${o.id}`)} />
        </Row>
      ) : null}
      <Row label="Rozmiar">
        <Slider value={o.size} min={24} max={260} onChange={(v) => patch(o.id, { size: v })} aria-label="Rozmiar typo" />
      </Row>
      <Row label="Tempo">
        <Slider value={o.speed ?? 1} min={0.5} max={2} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => patch(o.id, { speed: v })} />
      </Row>
      {o.preset !== "stairWipe" && o.preset !== "stairSteps" ? (
        <Row label="Wyrównanie">
          <Seg value={o.align ?? (o.preset === "stairTitle" || o.preset === "curtain" ? "left" : "center")} options={[["left", "Do lewej"], ["center", "Środek"]]} onChange={(v) => patch(o.id, { align: v })} />
        </Row>
      ) : null}
      <Row label="Motyw marki">
        <Seg value={o.motif ?? defaultMotif(doc.theme.name)} options={[["stairs", "Schodki"], ["bar", "Belka"], ["none", "Brak"]]} onChange={(v) => patch(o.id, { motif: v })} />
      </Row>
      {o.preset !== "stairWipe" && o.preset !== "stairSteps" ? <Toggle checked={!!o.plate} onChange={(v) => patch(o.id, { plate: v })} label={o.preset === "stamp" ? "Ciemna plakietka (zamiast złotej)" : "Podkład pod tekstem (czytelniej na jasnym kadrze)"} /> : null}
      <Row label="Akcent">
        <ColorField value={o.accent ?? "$accent"} onChange={(v) => patch(o.id, { accent: v ?? "$accent" })} theme={doc.theme} />
      </Row>
      <Row label="Podkład">
        <ColorField value={o.plateColor ?? "$background"} onChange={(v) => patch(o.id, { plateColor: v ?? "$background" })} theme={doc.theme} />
      </Row>
      {o.preset === "stairWipe" ? <p className="text-[11.5px] text-studio-muted">Przejście zasłania cały kadr: ustaw początek ok. 0,5 s przed cięciem, koniec ok. 0,5 s po nim.</p> : null}
    </>
  );
}
