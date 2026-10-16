"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Gauge, Minus, Mic, Plus, Type } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScriptFollower, spokenWords, tokenize, type ScriptWord } from "@/lib/prompter";

let sharedCtx: AudioContext | null = null;
/** Call inside the Start tap: iOS only lets audio processing start from a user gesture. */
export function primeAudio() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedCtx ??= new AC();
    void sharedCtx.resume().catch(() => {});
  } catch {
    /* no Web Audio — voice following falls back to tempo */
  }
}

/**
 * Live speech → text for the prompter: ElevenLabs Scribe v2 Realtime over a WebSocket opened with a
 * single-use token from our server (the API key never reaches the browser). Microphone audio is
 * resampled to 16 kHz PCM and streamed in ~250 ms chunks.
 */
class RealtimeStt {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private nodes: AudioNode[] = [];
  private committed = "";
  private partial = "";
  paused = false;
  closed = false;

  constructor(
    private stream: MediaStream,
    private onText: (text: string) => void,
    private onState: (s: "connecting" | "listening" | "error", msg?: string) => void,
  ) {}

  async start(recordToken: string) {
    this.onState("connecting");
    const res = await fetch(`/api/record/${recordToken}/stt`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { url?: string; sampleRate?: number; error?: string };
    if (!res.ok || !data.url) throw new Error(data.error ?? "Śledzenie głosu jest niedostępne");
    if (this.closed) return;
    const ws = new WebSocket(data.url);
    this.ws = ws;
    ws.onmessage = (ev) => {
      let m: { message_type?: string; text?: string; error?: string };
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (m.message_type === "session_started") this.onState("listening");
      else if (m.message_type === "partial_transcript") {
        this.partial = m.text ?? "";
        this.emit();
      } else if (m.message_type === "committed_transcript") {
        // keep only recent context — the follower looks at the last few words anyway
        this.committed = `${this.committed} ${m.text ?? ""}`.split(/\s+/).slice(-60).join(" ");
        this.partial = "";
        this.emit();
      } else if (m.error || /error|exceeded|limited|unaccepted|invalid/.test(m.message_type ?? "")) {
        this.onState("error", m.error ?? m.message_type);
      }
    };
    ws.onerror = () => this.onState("error", "Połączenie ze śledzeniem głosu zostało przerwane");
    ws.onclose = () => {
      if (!this.closed) this.onState("error", "Połączenie ze śledzeniem głosu zostało zamknięte");
    };
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("Nie udało się połączyć ze śledzeniem głosu")), { once: true });
    });
    this.startAudio(data.sampleRate ?? 16000);
  }

  private emit() {
    this.onText(`${this.committed} ${this.partial}`);
  }

  private startAudio(target: number) {
    primeAudio();
    const ctx = sharedCtx;
    if (!ctx) throw new Error("Przeglądarka nie obsługuje przetwarzania dźwięku");
    this.ctx = ctx;
    void ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(new MediaStream(this.stream.getAudioTracks()));
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(proc);
    proc.connect(mute);
    mute.connect(ctx.destination);
    this.nodes = [src, proc, mute];
    const ratio = ctx.sampleRate / target;
    let pending: Int16Array[] = [];
    let pendingLen = 0;
    proc.onaudioprocess = (e) => {
      if (this.paused || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      const n = Math.floor(input.length / ratio);
      const out = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        // average the source samples that fall into this output sample (cheap low-pass)
        const a = Math.floor(i * ratio);
        const b = Math.min(input.length, Math.floor((i + 1) * ratio));
        let sum = 0;
        for (let k = a; k < b; k++) sum += input[k];
        const v = Math.max(-1, Math.min(1, sum / Math.max(1, b - a)));
        out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      pending.push(out);
      pendingLen += n;
      if (pendingLen < target / 10) return; // ~100 ms per message: lower follow latency
      const all = new Int16Array(pendingLen);
      let o = 0;
      for (const p of pending) {
        all.set(p, o);
        o += p.length;
      }
      pending = [];
      pendingLen = 0;
      const bytes = new Uint8Array(all.buffer);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      this.ws.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: btoa(bin), commit: false, sample_rate: target }));
    };
  }

  stop() {
    this.closed = true;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    // the shared AudioContext stays open for the next take
  }
}

type Mode = "voice" | "tempo";
// the line being read sits near the top edge of the prompter — right under the front camera
const ANCHOR = 0.16;

export function Prompter(props: {
  hook: string;
  script: string | null;
  /** changes for every new take: resets to the beginning */
  takeKey: number;
  /** listening (connecting + countdown + recording) */
  armed: boolean;
  /** called once per arming when the text can follow: ElevenLabs is listening (or tempo mode) */
  onReady?: () => void;
  /** text moves (recording, not paused) */
  running: boolean;
  voiceAvailable: boolean;
  recordToken: string;
  stream: MediaStream | null;
  accent: string;
  font: string;
}) {
  const words = useMemo(() => tokenize(props.hook, props.script), [props.hook, props.script]);
  const follower = useRef(new ScriptFollower(words));
  const [pos, setPos] = useState(0);
  const [mode, setMode] = useState<Mode>(props.voiceAvailable ? "voice" : "tempo");
  const [size, setSize] = useState(() => readNum("prompter-size", 27));
  const [wpm, setWpm] = useState(() => readNum("prompter-wpm", 140));
  const [stt, setStt] = useState<{ state: "off" | "connecting" | "listening" | "error"; msg?: string }>({ state: "off" });
  const box = useRef<HTMLDivElement>(null);
  const userScroll = useRef<{ until: number; timer?: ReturnType<typeof setTimeout> }>({ until: 0 });
  const tempoAcc = useRef(0);

  // new script or new take → back to the start
  useEffect(() => {
    follower.current = new ScriptFollower(words);
    tempoAcc.current = 0;
    setPos(0);
    box.current?.scrollTo({ top: 0 });
  }, [words, props.takeKey]);

  useEffect(() => {
    try {
      localStorage.setItem("prompter-size", String(size));
      localStorage.setItem("prompter-wpm", String(wpm));
    } catch {
      /* ignore */
    }
  }, [size, wpm]);

  // voice following
  const sttRef = useRef<RealtimeStt | null>(null);
  useEffect(() => {
    if (!props.armed || mode !== "voice" || !props.stream || !props.voiceAvailable) return;
    const s = new RealtimeStt(
      props.stream,
      (text) => setPos(follower.current.update(spokenWords(text))),
      (state, msg) => {
        setStt({ state, msg });
        if (state === "error") setMode("tempo"); // never leave the expert without a moving text
      },
    );
    sttRef.current = s;
    s.start(props.recordToken).catch((e: Error) => {
      setStt({ state: "error", msg: e.message });
      setMode("tempo");
    });
    return () => {
      s.stop();
      sttRef.current = null;
      setStt((v) => (v.state === "error" ? v : { state: "off" }));
    };
  }, [props.armed, mode, props.stream, props.voiceAvailable, props.recordToken]);
  useEffect(() => {
    if (sttRef.current) sttRef.current.paused = !props.running && !props.armed;
  }, [props.running, props.armed]);

  // recording may start only once the voice follower really listens (no lag on the first words)
  const fired = useRef(false);
  const onReady = useRef(props.onReady);
  onReady.current = props.onReady;
  useEffect(() => {
    if (!props.armed) {
      fired.current = false;
      return;
    }
    if (fired.current) return;
    const ready = mode === "tempo" || !props.voiceAvailable || stt.state === "listening";
    if (ready) {
      fired.current = true;
      // a short warm-up so the first audio chunks are already on their way
      const t = setTimeout(() => onReady.current?.(), mode === "voice" && props.voiceAvailable ? 350 : 0);
      return () => clearTimeout(t);
    }
    // ElevenLabs does not answer → do not keep the expert waiting
    const t = setTimeout(() => {
      if (fired.current) return;
      setStt({ state: "error", msg: "Śledzenie głosu nie odpowiada" });
      setMode("tempo");
    }, 8000);
    return () => clearTimeout(t);
  }, [props.armed, mode, stt.state, props.voiceAvailable]);

  // constant tempo (fallback or chosen)
  useEffect(() => {
    if (!props.running || mode !== "tempo") return;
    tempoAcc.current = Math.max(tempoAcc.current, follower.current.pos);
    const t = setInterval(() => {
      if (Date.now() < userScroll.current.until) return;
      tempoAcc.current += wpm / 60 / 10;
      const p = Math.min(words.length, Math.floor(tempoAcc.current));
      follower.current.jump(p);
      setPos(p);
    }, 100);
    return () => clearInterval(t);
  }, [props.running, mode, wpm, words.length]);

  // keep the current line at the reading anchor
  useEffect(() => {
    const el = box.current;
    if (!el || Date.now() < userScroll.current.until) return;
    const span = el.querySelector<HTMLElement>(`[data-i="${Math.max(0, Math.min(words.length - 1, pos))}"]`);
    if (!span) return;
    el.scrollTo({ top: Math.max(0, span.offsetTop - el.clientHeight * ANCHOR), behavior: "smooth" });
  }, [pos, words.length, size]);

  const jump = (i: number) => {
    follower.current.jump(i);
    tempoAcc.current = i;
    setPos(i);
  };

  /** finger/wheel scrolling: follow the user, then re-anchor to the word on the reading line */
  const onManualScroll = () => {
    userScroll.current.until = Date.now() + 1500;
    clearTimeout(userScroll.current.timer);
    userScroll.current.timer = setTimeout(() => {
      const el = box.current;
      if (!el) return;
      const line = el.scrollTop + el.clientHeight * ANCHOR;
      const spans = [...el.querySelectorAll<HTMLElement>("[data-i]")];
      const hit = spans.find((s) => s.offsetTop + s.offsetHeight >= line);
      userScroll.current.until = 0;
      if (hit) jump(Number(hit.dataset.i));
    }, 1300);
  };

  const paras = useMemo(() => {
    const out: Array<{ para: number; items: Array<{ w: ScriptWord; i: number }> }> = [];
    words.forEach((w, i) => {
      const last = out[out.length - 1];
      if (last && last.para === w.para) last.items.push({ w, i });
      else out.push({ para: w.para, items: [{ w, i }] });
    });
    return out;
  }, [words]);

  return (
    <div className="flex h-full flex-col" data-testid="prompter" data-pos={pos} data-mode={mode}>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-black/55 backdrop-blur-[2px]">
        {/* reading line marker */}
        <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: `${ANCHOR * 100}%` }}>
          <span className="h-0 w-0 border-y-[7px] border-l-[9px] border-y-transparent" style={{ borderLeftColor: props.accent }} />
        </div>
        <div
          ref={box}
          className="scroll-thin h-full overflow-y-auto px-5 [mask-image:linear-gradient(to_bottom,transparent,black_6%,black_80%,transparent)]"
          onWheel={onManualScroll}
          onTouchMove={onManualScroll}
        >
          <div style={{ height: `${ANCHOR * 100 - 2}%` }} />
          {paras.map((p) => (
            <p
              key={`${p.para}-${p.items[0].i}`}
              className={cn("mb-[0.7em] leading-[1.35]", p.para === 0 ? "font-extrabold uppercase" : "font-semibold")}
              style={{ fontSize: p.para === 0 ? size * 1.05 : size, fontFamily: `"${props.font}", var(--font-display)` }}
            >
              {p.items.map(({ w, i }) => (
                <span
                  key={i}
                  data-i={i}
                  onClick={() => jump(i)}
                  className={cn("cursor-pointer rounded-[4px] transition-colors duration-200", i < pos ? "text-white/30" : i === pos ? "text-white" : "text-white/90")}
                  style={i === pos ? { boxShadow: `inset 0 -0.14em 0 ${props.accent}` } : undefined}
                >
                  {w.text}{" "}
                </span>
              ))}
            </p>
          ))}
          <div style={{ height: "70%" }} />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[12px]">
        <div className="flex rounded-full bg-black/45 p-0.5 backdrop-blur">
          <button
            type="button"
            disabled={!props.voiceAvailable}
            onClick={() => setMode("voice")}
            className={cn("flex items-center gap-1 rounded-full px-2.5 py-1 disabled:opacity-40", mode === "voice" ? "bg-white text-black" : "text-white/80")}
          >
            <Mic className="h-3.5 w-3.5" /> Głos
          </button>
          <button type="button" onClick={() => setMode("tempo")} className={cn("flex items-center gap-1 rounded-full px-2.5 py-1", mode === "tempo" ? "bg-white text-black" : "text-white/80")}>
            <Gauge className="h-3.5 w-3.5" /> Tempo
          </button>
        </div>
        {mode === "tempo" ? (
          <div className="flex items-center rounded-full bg-black/45 backdrop-blur">
            <button type="button" aria-label="Wolniej" className="px-2 py-1" onClick={() => setWpm((v) => Math.max(60, v - 15))}>
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="tabular w-14 text-center">{wpm} sł/min</span>
            <button type="button" aria-label="Szybciej" className="px-2 py-1" onClick={() => setWpm((v) => Math.min(260, v + 15))}>
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <span className="flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 backdrop-blur" data-testid="stt-state">
            <span className={cn("h-2 w-2 rounded-full", stt.state === "listening" ? "bg-emerald-400" : stt.state === "connecting" ? "animate-pulse bg-amber-300" : "bg-white/40")} />
            {stt.state === "listening" ? "Słucham" : stt.state === "connecting" ? "Łączę…" : "Start = słuchanie"}
          </span>
        )}
        <div className="ml-auto flex items-center rounded-full bg-black/45 backdrop-blur">
          <button type="button" aria-label="Mniejszy tekst" className="px-2 py-1" onClick={() => setSize((v) => Math.max(18, v - 2))}>
            <Type className="h-3 w-3" />
          </button>
          <button type="button" aria-label="Większy tekst" className="px-2 py-1" onClick={() => setSize((v) => Math.min(44, v + 2))}>
            <Type className="h-4 w-4" />
          </button>
        </div>
      </div>
      {stt.state === "error" && stt.msg ? <p className="mt-1 text-[11.5px] text-amber-200">{stt.msg} — przełączono na stałe tempo.</p> : null}
    </div>
  );
}

function readNum(key: string, def: number) {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : def;
  } catch {
    return def;
  }
}
