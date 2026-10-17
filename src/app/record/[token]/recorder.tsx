"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { terms } from "@/lib/project-terms";
import { primeAudio, Prompter } from "./prompter";
import { AlertTriangle, Camera, Expand, Shrink, ZoomIn, Check, CheckCircle2, ChevronLeft, ChevronRight, CloudUpload, Loader2, Mic, Pause, Play, RefreshCw, RotateCcw, Square, SwitchCamera, Volume2, WifiOff } from "lucide-react";
import { cn, formatDuration, plural } from "@/lib/utils";
import { cameraErrorMessage, detectSupport, openCamera, requestWakeLock, setZoom, stopStream, zoomRange, type Facing, type RecorderSupport } from "@/lib/client/media";
import { newClientId, pendingTakes, removeTake, saveChunk, saveTake, saveTakeMeta, uploadTake, type PendingTake } from "@/lib/client/take-store";

interface Question {
  id: string;
  text: string;
  instructions: string | null;
  maxDurationSec: number | null;
  category: string;
  subcategory?: string | null;
  /** Prompter projects: the script read after the hook (text) */
  script?: string | null;
  status: string;
  /** QUESTION (narrator) | PROMPTER | QUESTION_PROMPTER (narrator + prompter) */
  kind?: "QUESTION" | "PROMPTER" | "QUESTION_PROMPTER";
  takes: Array<{ id: string; takeNumber: number; status: string }>;
}

interface Session {
  project: { id: string; name: string; description: string | null; mode: "CONTINUOUS" | "ANSWER_ONLY"; sequential: boolean; format: "ANSWERS" | "PROMPTER" | "HYBRID" };
  expert: { name: string };
  consentGiven: boolean;
  narrationAvailable: boolean;
  /** Prompter: ElevenLabs Scribe v2 Realtime can follow the expert's voice */
  voiceFollow: boolean;
  theme: { primary: string; accent: string; font: string } | null;
  /** many questions: today's list, mixed evenly across categories */
  dailyPlan: { limit: number; pendingTotal: number; totalQuestions: number } | null;
  questions: Question[];
  /** films being edited / approved, to watch */
  videos?: ExpertVideo[];
}

interface ExpertVideo {
  questionId: string;
  text: string;
  category: string;
  status: string;
}

type Screen = "loading" | "error" | "welcome" | "setup" | "list" | "record" | "done";
type Phase = "idle" | "connecting" | "narrating" | "countdown" | "recording" | "paused" | "review";

interface UploadState {
  questionId: string;
  progress: number;
  status: "queued" | "uploading" | "done" | "error";
  note?: string;
}

const DEFAULT_ANSWER_SEC = 90;

export function Recorder({ token }: { token: string }) {
  const [screen, setScreen] = useState<Screen>("loading");
  const [videosOpen, setVideosOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [support, setSupport] = useState<RecorderSupport | null>(null);
  const [consent, setConsent] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facing, setFacing] = useState<Facing>("user");
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [fit, setFit] = useFitPreference();
  const [camError, setCamError] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [online, setOnline] = useState(true);
  const [landscape, setLandscape] = useState(false);
  const uploadQueue = useRef<PendingTake[]>([]);
  const uploading = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/record/${token}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Nie udało się otworzyć linku");
      setSession(data);
      return data as Session;
    } catch (e) {
      setError((e as Error).message);
      setScreen("error");
      return null;
    }
  }, [token]);

  // ---- uploads (resumable, persisted) ----
  const pump = useCallback(async () => {
    if (uploading.current) return;
    uploading.current = true;
    try {
      while (uploadQueue.current.length) {
        const t = uploadQueue.current[0];
        setUploads((u) => ({ ...u, [t.clientId]: { questionId: t.questionId, progress: 0, status: "uploading" } }));
        try {
          await uploadTake(t, (p, note) => setUploads((u) => ({ ...u, [t.clientId]: { questionId: t.questionId, progress: p, status: p >= 1 ? "done" : "uploading", note } })));
          await removeTake(t.clientId);
          setUploads((u) => ({ ...u, [t.clientId]: { questionId: t.questionId, progress: 1, status: "done" } }));
          uploadQueue.current.shift();
          void load();
        } catch (e) {
          setUploads((u) => ({ ...u, [t.clientId]: { questionId: t.questionId, progress: 0, status: "error", note: (e as Error).message } }));
          uploadQueue.current.shift();
        }
      }
    } finally {
      uploading.current = false;
    }
  }, [load]);

  const enqueueUpload = useCallback(
    (t: PendingTake) => {
      if (uploadQueue.current.some((x) => x.clientId === t.clientId)) return;
      uploadQueue.current.push(t);
      setUploads((u) => ({ ...u, [t.clientId]: { questionId: t.questionId, progress: 0, status: "queued" } }));
      void pump();
    },
    [pump],
  );

  const retryFailed = useCallback(async () => {
    for (const t of await pendingTakes(token)) enqueueUpload(t);
  }, [token, enqueueUpload]);

  useEffect(() => {
    setSupport(detectSupport());
    void (async () => {
      const s = await load();
      if (!s) return;
      setConsent(s.consentGiven);
      setScreen("welcome");
      // resume uploads left over from a previous visit (closed tab, lost connection, crash)
      for (const t of await pendingTakes(token)) enqueueUpload(t);
    })();
    const on = () => setOnline(navigator.onLine);
    on();
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    const mq = window.matchMedia("(orientation: landscape) and (max-height: 500px)");
    const o = () => setLandscape(mq.matches);
    o();
    mq.addEventListener("change", o);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
      mq.removeEventListener("change", o);
    };
  }, [load, token, enqueueUpload]);

  const pendingCount = Object.values(uploads).filter((u) => u.status !== "done").length;
  useEffect(() => {
    if (!pendingCount) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [pendingCount]);

  // ---- camera ----
  const startCamera = useCallback(
    async (f: Facing) => {
      setCamError(null);
      stopStream(stream);
      try {
        const s = await openCamera(f);
        setStream(s);
        try {
          const devs = await navigator.mediaDevices.enumerateDevices();
          setHasMultipleCameras(devs.filter((d) => d.kind === "videoinput").length > 1);
        } catch {
          /* ignore */
        }
        return s;
      } catch (e) {
        setCamError(cameraErrorMessage(e));
        return null;
      }
    },
    [stream],
  );

  useEffect(() => () => stopStream(stream), [stream]);

  const questions = session?.questions ?? [];
  const isRecorded = useCallback(
    // "to fix" questions count as open until re-recorded
    (q: Question) => (q.takes.length > 0 && q.status !== "NEEDS_FIX") || Object.values(uploads).some((u) => u.questionId === q.id),
    [uploads],
  );
  const firstOpen = questions.find((q) => !isRecorded(q));
  const current = questions.find((q) => q.id === currentId) ?? null;

  const openQuestion = (q: Question) => {
    setCurrentId(q.id);
    setScreen("record");
  };

  const nextQuestion = () => {
    const idx = questions.findIndex((q) => q.id === currentId);
    const after = [...questions.slice(idx + 1), ...questions.slice(0, idx)].find((q) => !isRecorded(q) && q.id !== currentId);
    if (after) setCurrentId(after.id);
    else setScreen("done");
  };

  if (screen === "loading") {
    return (
      <Shell>
        <div className="flex h-dvh items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-white/60" />
        </div>
      </Shell>
    );
  }

  if (screen === "error" || !session) {
    return (
      <Shell>
        <div className="flex h-dvh flex-col items-center justify-center px-8 text-center">
          <AlertTriangle className="mb-4 h-10 w-10 text-amber-400" />
          <h1 className="font-display text-xl font-semibold">Nie można otworzyć nagrania</h1>
          <p className="mt-2 text-white/70">{error}</p>
        </div>
      </Shell>
    );
  }

  const unsupported = support && (!support.mediaDevices || !support.mediaRecorder || !support.mimeType);
  const T = terms(session.project.format);

  if (screen === "welcome") {
    const remaining = questions.filter((q) => !isRecorded(q)).length;
    const est = questions.reduce((n, q) => n + (q.maxDurationSec ?? DEFAULT_ANSWER_SEC) + 20, 0);
    return (
      <Shell>
        {videosOpen ? <VideosSheet token={token} videos={session.videos ?? []} onClose={() => setVideosOpen(false)} /> : null}
        <div className="mx-auto flex min-h-dvh max-w-md flex-col px-6 safe-top safe-bottom">
          <div className="pt-10">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-white/50">{session.project.name}</p>
              <VideosButton count={session.videos?.length ?? 0} onClick={() => setVideosOpen(true)} />
            </div>
            <h1 className="mt-6 font-display text-[34px] font-semibold leading-[1.1]">
              Dzień dobry{session.expert.name ? `, ${session.expert.name.split(" ")[0]}` : ""}!
              <br />
              <span className="text-white/60">
                {session.dailyPlan
                  ? `Na dziś masz ${questions.length} ${plural(questions.length, T.one, T.few, T.many)} — po trochu z każdej kategorii.`
                  : `Masz ${questions.length} ${plural(questions.length, T.one, T.few, T.many)} do nagrania.`}
              </span>
              {session.dailyPlan ? (
                <span className="mt-3 block text-[15px] font-normal leading-snug text-white/45">
                  Łącznie czeka {session.dailyPlan.pendingTotal} {plural(session.dailyPlan.pendingTotal, T.one, T.few, T.many)}. Kolejne pojawią się jutro.
                </span>
              ) : null}
            </h1>
            <div className="mt-8 grid grid-cols-2 gap-3">
              <Stat label="Pytania" value={String(questions.length)} sub={remaining < questions.length ? `${remaining} pozostało` : "wszystkie do nagrania"} />
              <Stat label="Szacowany czas" value={`~${Math.max(1, Math.round(est / 60))} min`} sub="w dowolnym tempie" />
            </div>
            <ol className="mt-8 space-y-3 text-[15px] text-white/75">
              <li className="flex gap-3"><Num n={1} /> Wybierz pytanie z listy.</li>
              <li className="flex gap-3"><Num n={2} /> Wysłuchaj pytania czytanego przez lektora.</li>
              <li className="flex gap-3"><Num n={3} /> Odpowiedz naturalnie do kamery.</li>
              <li className="flex gap-3"><Num n={4} /> Kliknij „Następne pytanie”. Resztą zajmiemy się my.</li>
            </ol>
          </div>
          <div className="mt-auto space-y-4 pt-10">
            {unsupported ? (
              <div className="rounded-2xl bg-amber-500/15 p-4 text-sm text-amber-100">
                Ta przeglądarka nie obsługuje nagrywania wideo{support && !support.mediaRecorder ? " (brak MediaRecorder)" : ""}. Otwórz link w aktualnym Safari (iPhone) lub Chrome (Android).
              </div>
            ) : null}
            <label className="flex items-start gap-3 rounded-2xl bg-white/[.06] p-4 text-[13px] leading-relaxed text-white/75">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-white" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                Wyrażam zgodę na nagranie mojego wizerunku i głosu oraz ich przetwarzanie w celu przygotowania materiałów wideo w projekcie „{session.project.name}”.
                Nagrania są przechowywane prywatnie; dźwięk odpowiedzi jest przesyłany do ElevenLabs w celu automatycznej transkrypcji i napisów.
              </span>
            </label>
            <button
              className="h-14 w-full rounded-2xl bg-white text-[17px] font-semibold text-black transition active:scale-[.98] disabled:opacity-40"
              disabled={!consent || !!unsupported}
              onClick={async () => {
                if (!session.consentGiven) await fetch(`/api/record/${token}/consent`, { method: "POST" });
                setScreen("setup");
                void startCamera(facing);
              }}
            >
              Rozpocznij nagrywanie
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  if (screen === "setup") {
    return (
      <Shell>
        <div className="relative h-dvh w-full overflow-hidden">
          <CameraView stream={stream} mirrored={facing === "user"} fit={fit} />
          <FaceGuide mirrored={facing === "user"} />
          <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent px-5 pb-10 safe-top">
            <p className="pt-2 font-display text-xl font-semibold">Przygotuj kamerę</p>
            <p className="text-sm text-white/70">Ustaw twarz w zaznaczonym obszarze. Za blisko? Odsuń telefon lub zmień podgląd poniżej.</p>
          </div>
          {camError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 px-8 text-center">
              <Camera className="mb-4 h-10 w-10 text-white/50" />
              <p className="text-white/85">{camError}</p>
              <button className="mt-6 h-12 rounded-2xl bg-white px-6 font-semibold text-black" onClick={() => startCamera(facing)}>
                Spróbuj ponownie
              </button>
            </div>
          ) : null}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-5 pt-16 safe-bottom">
            <CameraAdjust stream={stream} fit={fit} onFit={setFit} />
            <ul className="mb-5 grid grid-cols-2 gap-2 text-[13px] text-white/85">
              {["Ustaw telefon pionowo", "Kamera na wysokości oczu", "Zadbaj o dobre oświetlenie", "Nagrywaj w cichym miejscu"].map((t) => (
                <li key={t} className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 backdrop-blur">
                  <Check className="h-4 w-4 text-emerald-400" /> {t}
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-3">
              {hasMultipleCameras ? (
                <button
                  aria-label="Przełącz kamerę"
                  className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur active:scale-95"
                  onClick={() => {
                    const f = facing === "user" ? "environment" : "user";
                    setFacing(f);
                    void startCamera(f);
                  }}
                >
                  <SwitchCamera className="h-6 w-6" />
                </button>
              ) : null}
              <button className="h-14 flex-1 rounded-2xl bg-white text-[17px] font-semibold text-black active:scale-[.98] disabled:opacity-40" disabled={!stream} onClick={() => setScreen("list")}>
                Gotowe — wybierz pytanie
              </button>
            </div>
          </div>
          {landscape ? <RotateHint /> : null}
        </div>
      </Shell>
    );
  }

  if (screen === "list") {
    // what is still to record first, what is done below (the category is shown on each card)
    const groups = new Map<string, Question[]>([
      ["Do nagrania", questions.filter((q) => !isRecorded(q))],
      ["Nagrane", questions.filter((q) => isRecorded(q))],
    ]);
    for (const [k, v] of groups) if (!v.length) groups.delete(k);
    const done = questions.filter(isRecorded).length;
    return (
      <Shell>
        {videosOpen ? <VideosSheet token={token} videos={session.videos ?? []} onClose={() => setVideosOpen(false)} /> : null}
        <div className="mx-auto min-h-dvh max-w-md px-5 pb-32 safe-top">
          <div className="sticky top-0 z-10 -mx-5 bg-[#0c0d10]/90 px-5 pb-3 pt-4 backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">{session.project.name}</p>
              <VideosButton count={session.videos?.length ?? 0} onClick={() => setVideosOpen(true)} />
            </div>
            <div className="mt-1 flex items-end justify-between">
              <h1 className="font-display text-2xl font-semibold">{T.prompter ? "Twoje skrypty" : "Twoje pytania"}</h1>
              <span className="tabular text-sm text-white/60">
                {done}/{questions.length} nagrane
              </span>
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${(done / Math.max(1, questions.length)) * 100}%` }} />
            </div>
          </div>
          <UploadBanner uploads={uploads} online={online} onRetry={retryFailed} />
          {[...groups.entries()].map(([cat, qs]) => (
            <section key={cat} className="mt-6" data-testid={cat === "Nagrane" ? "list-recorded" : "list-todo"}>
              <h2 className={cn("mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em]", cat === "Nagrane" ? "text-emerald-300/80" : "text-white/60")}>
                {cat === "Nagrane" ? <Check className="h-3.5 w-3.5" /> : null}
                {cat} <span className="tabular font-normal text-white/40">{qs.length}</span>
              </h2>
              <div className="space-y-3">
                {qs.map((q) => {
                  const n = questions.indexOf(q) + 1;
                  const recorded = isRecorded(q);
                  const locked = session.project.sequential && !recorded && firstOpen && firstOpen.id !== q.id;
                  const up = Object.values(uploads).filter((u) => u.questionId === q.id);
                  const uploadingNow = up.some((u) => u.status !== "done" && u.status !== "error");
                  return (
                    <button
                      key={q.id}
                      disabled={!!locked}
                      onClick={() => openQuestion(q)}
                      className={cn(
                        "flex w-full items-start gap-4 rounded-2xl p-4 text-left transition active:scale-[.99]",
                        recorded ? "bg-white/[.05]" : "bg-white/[.09]",
                        locked && "opacity-40",
                      )}
                    >
                      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold", recorded ? "bg-emerald-400 text-black" : "bg-white/10")}>
                        {recorded ? <Check className="h-4 w-4" /> : n}
                      </span>
                      <span className="flex-1">
                        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">{[q.category, q.subcategory].filter(Boolean).join(" · ")}</span>
                        <span className="block text-[16px] font-medium leading-snug">{q.text}</span>
                        <span className="mt-1.5 block text-[12.5px] text-white/50">
                          {uploadingNow
                            ? "Wysyłanie…"
                            : recorded
                              ? `${q.status === "APPROVED" ? "Film zatwierdzony" : q.status === "IN_PROGRESS" ? "Film w trakcie montażu" : "Nagrane"}${q.takes.length > 1 ? ` · ${q.takes.length} ujęcia` : ""} · dotknij, aby nagrać ponownie`
                              : q.status === "NEEDS_FIX"
                                ? "Do poprawy"
                                : locked
                                  ? "Odblokuje się po poprzednim pytaniu"
                                  : "Do nagrania"}
                        </span>
                      </span>
                      <ChevronRight className="mt-1.5 h-5 w-5 text-white/30" />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-[#0c0d10] via-[#0c0d10]/95 to-transparent px-5 pt-8 safe-bottom">
            <div className="mx-auto flex max-w-md gap-3">
              {firstOpen ? (
                <button className="h-14 flex-1 rounded-2xl bg-white text-[16px] font-semibold text-black active:scale-[.98]" onClick={() => openQuestion(firstOpen)}>
                  {T.prompter ? "Nagraj następny skrypt" : "Nagraj następne pytanie"}
                </button>
              ) : null}
              <button className={cn("h-14 rounded-2xl px-5 text-[16px] font-semibold active:scale-[.98]", firstOpen ? "bg-white/10" : "flex-1 bg-white text-black")} onClick={() => setScreen("done")}>
                Zakończ
              </button>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  if (screen === "record" && current) {
    return (
      <RecordScreen
        key={current.id}
        token={token}
        session={session}
        question={current}
        index={questions.indexOf(current)}
        total={questions.length}
        stream={stream}
        mirrored={facing === "user"}
        fit={fit}
        onFit={setFit}
        support={support!}
        uploads={uploads}
        online={online}
        landscape={landscape}
        onBack={() => setScreen("list")}
        onSaved={(t) => enqueueUpload(t)}
        onNext={nextQuestion}
        onFinish={() => setScreen("done")}
        onRestartCamera={() => startCamera(facing)}
      />
    );
  }

  // done
  const completed = questions.filter(isRecorded).length;
  const uploadedOk = questions.reduce((n, q) => n + q.takes.length, 0);
  const stillUploading = Object.values(uploads).filter((u) => u.status === "uploading" || u.status === "queued").length;
  const failed = Object.values(uploads).filter((u) => u.status === "error").length;
  return (
    <Shell>
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-6 safe-top safe-bottom">
        <div className="flex flex-1 flex-col justify-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-400/15">
            <CheckCircle2 className="h-9 w-9 text-emerald-400" />
          </div>
          <h1 className="text-center font-display text-[28px] font-semibold leading-tight">Dziękujemy! {T.prompter ? "Twoje nagrania są zapisane." : "Twoje odpowiedzi zostały nagrane."}</h1>
          <div className="mt-8 grid grid-cols-3 gap-2">
            <Stat label="Nagrane" value={String(completed)} />
            <Stat label="Bez odpowiedzi" value={String(questions.length - completed)} />
            <Stat label="Wysłane" value={String(Math.max(0, uploadedOk))} />
          </div>
          {stillUploading ? (
            <p className="mt-6 flex items-center justify-center gap-2 text-sm text-amber-200">
              <Loader2 className="h-4 w-4 animate-spin" /> Trwa wysyłanie {stillUploading} {plural(stillUploading, "nagrania", "nagrań", "nagrań")} — nie zamykaj tej strony.
            </p>
          ) : failed ? (
            <button className="mx-auto mt-6 flex items-center gap-2 text-sm text-red-300 underline" onClick={retryFailed}>
              <RefreshCw className="h-4 w-4" /> Ponów wysyłanie ({failed})
            </button>
          ) : (
            <p className="mt-6 text-center text-sm text-white/60">Wszystkie nagrania zostały bezpiecznie zapisane.</p>
          )}
          {questions.length - completed > 0 ? (
            <p className="mt-4 text-center text-sm text-white/50">Możesz wrócić i nagrać brakujące pytania, dopóki link jest aktywny.</p>
          ) : null}
        </div>
        <button className="h-14 w-full rounded-2xl bg-white/10 text-[16px] font-semibold" onClick={() => setScreen(stream ? "list" : "setup")}>
          Wróć do pytań
        </button>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------

function RecordScreen(props: {
  token: string;
  session: Session;
  question: Question;
  index: number;
  total: number;
  stream: MediaStream | null;
  mirrored: boolean;
  fit: Fit;
  onFit: (f: Fit) => void;
  support: RecorderSupport;
  uploads: Record<string, UploadState>;
  online: boolean;
  landscape: boolean;
  onBack: () => void;
  onSaved: (t: PendingTake) => void;
  onNext: () => void;
  onFinish: () => void;
  onRestartCamera: () => Promise<MediaStream | null>;
}) {
  const { session, question, stream, support } = props;
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [narration, setNarration] = useState<{ url: string; assetId: string; duration: number } | null>(null);
  const [narrationState, setNarrationState] = useState<"loading" | "ready" | "unavailable" | "error">(session.narrationAvailable ? "loading" : "unavailable");
  const [narrationMsg, setNarrationMsg] = useState<string | null>(null);
  const [answerCue, setAnswerCue] = useState(false);
  const [lastClientId, setLastClientId] = useState<string | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const clock = useRef({ acc: 0, since: 0, running: false });
  const markers = useRef<{ narrationStart: number | null; narrationEnd: number | null }>({ narrationStart: null, narrationEnd: null });
  const clientId = useRef<string>("");
  const modeRef = useRef<"CONTINUOUS" | "ANSWER_ONLY">(session.project.mode);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const cancelCountdown = useRef(false);
  // what this item is: the narrator reads the question and/or the expert reads from the prompter
  const kind = question.kind ?? (session.project.format === "PROMPTER" ? "PROMPTER" : "QUESTION");
  const isPrompter = kind !== "QUESTION";
  const withNarrator = kind !== "PROMPTER" && session.narrationAvailable;
  const [takeKey, setTakeKey] = useState(0);

  const now = () => (clock.current.running ? clock.current.acc + (performance.now() - clock.current.since) / 1000 : clock.current.acc);

  // fetch (or generate once) the ElevenLabs narration for this question
  useEffect(() => {
    if (!withNarrator) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/record/${props.token}/narration`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id }) });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setNarrationState(data.code === "not_configured" ? "unavailable" : "error");
          setNarrationMsg(data.error ?? null);
          return;
        }
        setNarration({ url: data.url, assetId: data.assetId, duration: data.duration });
        setNarrationState("ready");
        const a = audioRef.current;
        if (a) {
          a.src = data.url;
          a.load();
        }
      } catch {
        if (!cancelled) setNarrationState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [question.id, props.token, withNarrator]);

  useEffect(() => {
    const id = setInterval(() => setElapsed(now()), 200);
    return () => clearInterval(id);
  }, []);

  useEffect(
    () => () => {
      // leaving the screen: stop any running recorder/audio
      try {
        if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
      } catch {
        /* ignore */
      }
      audioRef.current?.pause();
      void wakeLock.current?.release();
    },
    [],
  );

  const setMic = (enabled: boolean) => stream?.getAudioTracks().forEach((t) => (t.enabled = enabled));

  /** Synchronous up to rec.start() so it can run inside the same tap as audio.play(). */
  const startRecorder = (): boolean => {
    const s = stream;
    if (!s || s.getTracks().some((t) => t.readyState === "ended") || !support.mimeType) {
      setRecError("Kamera nie jest dostępna — wróć do listy pytań i spróbuj ponownie.");
      void props.onRestartCamera();
      return false;
    }
    chunks.current = [];
    clientId.current = newClientId();
    markers.current = { narrationStart: null, narrationEnd: null };
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(s, { mimeType: support.mimeType, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 128_000 });
    } catch {
      try {
        rec = new MediaRecorder(s);
      } catch (e) {
        setRecError(`Nie można rozpocząć nagrywania: ${(e as Error).message}`);
        return false;
      }
    }
    const mime = rec.mimeType || support.mimeType;
    let idx = 0;
    void saveTakeMeta(clientId.current, {
      clientId: clientId.current,
      token: props.token,
      questionId: question.id,
      mimeType: mime,
      mode: modeRef.current,
      narrationAssetId: narration?.assetId ?? null,
      // front camera: saved mirrored, exactly as the expert sees themselves in the preview
      markers: { ...markers.current, mirrored: props.mirrored },
      durationSec: 0,
      createdAt: Date.now(),
    });
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.current.push(e.data);
        void saveChunk(clientId.current, idx++, e.data);
      }
    };
    rec.onerror = (e) => setRecError(`Błąd nagrywania: ${(e as unknown as { error?: Error }).error?.message ?? "nieznany"}`);
    rec.onstop = async () => {
      const duration = now();
      clock.current = { acc: duration, since: 0, running: false };
      const blob = new Blob(chunks.current, { type: mime.split(";")[0] });
      if (blob.size === 0) {
        setRecError("Nagranie jest puste. Spróbuj ponownie.");
        setPhase("idle");
        return;
      }
      const take: PendingTake = {
        clientId: clientId.current,
        token: props.token,
        questionId: question.id,
        mimeType: mime,
        mode: modeRef.current,
        narrationAssetId: narration?.assetId ?? null,
        markers: { ...markers.current, mirrored: props.mirrored },
        durationSec: duration,
        blob,
        createdAt: Date.now(),
      };
      try {
        await saveTake(take);
      } catch {
        /* IndexedDB unavailable — upload straight from memory */
      }
      setLastClientId(take.clientId);
      props.onSaved(take);
      setPhase("review");
    };
    rec.start(1000);
    recRef.current = rec;
    clock.current = { acc: 0, since: performance.now(), running: true };
    void requestWakeLock().then((w) => (wakeLock.current = w));
    return true;
  };

  /** Calls play() synchronously (user-gesture safe); resolves to whether playback started. */
  const playNarration = (): Promise<boolean> => {
    const a = audioRef.current;
    if (!a || !narration) return Promise.resolve(false);
    try {
      a.currentTime = 0;
      return a.play().then(
        () => true,
        () => false,
      );
    } catch {
      return Promise.resolve(false);
    }
  };

  const onNarrationEnded = () => {
    if (phase === "narrating" && modeRef.current === "CONTINUOUS") {
      markers.current.narrationEnd = now();
      setMic(true);
      setPhase("recording");
      setAnswerCue(true);
      setTimeout(() => setAnswerCue(false), 2500);
    } else if (phase === "narrating" && modeRef.current === "ANSWER_ONLY") {
      // question + prompter: after the question the prompter connects, then the countdown
      if (isPrompter) connectPrompter();
      else void runCountdown();
    }
  };

  const runCountdown = async () => {
    cancelCountdown.current = false;
    setPhase("countdown");
    for (let i = 3; i >= 1; i--) {
      setCountdown(i);
      await new Promise((r) => setTimeout(r, 1000));
      if (cancelCountdown.current) return;
    }
    if (startRecorder()) {
      setMic(true);
      setPhase("recording");
      if (!isPrompter) setAnswerCue(true);
      setTimeout(() => setAnswerCue(false), 2000);
    } else setPhase("idle");
  };

  /** First connect the voice follower; the countdown starts only once ElevenLabs is really listening (onPrompterReady). */
  const connectPrompter = () => {
    modeRef.current = "ANSWER_ONLY";
    setTakeKey((k) => k + 1);
    setPhase("connecting");
  };

  const start = async () => {
    setRecError(null);
    if (isPrompter) {
      modeRef.current = "ANSWER_ONLY";
      if (session.voiceFollow) primeAudio();
      // question + prompter: the narrator reads the client's question first (not recorded)
      if (kind === "QUESTION_PROMPTER" && narrationState === "ready" && narration && (await playNarration())) {
        setPhase("narrating");
        return;
      }
      connectPrompter();
      return;
    }
    const withNarration = narrationState === "ready" && !!narration;
    modeRef.current = session.project.mode;
    if (modeRef.current === "CONTINUOUS" && withNarration) {
      // Mode A: camera rolls first; mic muted while the narration plays (no echo / double voice).
      // Recorder start and play() both run synchronously inside the tap, so autoplay
      // policies allow playback and the narration marker lines up with the footage.
      setMic(false);
      if (!startRecorder()) {
        setMic(true);
        return;
      }
      const playing = playNarration();
      markers.current.narrationStart = now();
      if (!(await playing)) {
        // playback blocked/failed: graceful fallback — just answer
        setMic(true);
        markers.current = { narrationStart: null, narrationEnd: null };
        setNarrationMsg("Nie udało się odtworzyć lektora — odpowiedz na pytanie widoczne na ekranie.");
        setPhase("recording");
        return;
      }
      setPhase("narrating");
      return;
    }
    if (withNarration) {
      // Mode B: listen first, then 3-second countdown, then record the answer only
      modeRef.current = "ANSWER_ONLY";
      if (await playNarration()) {
        setPhase("narrating");
        return;
      }
    }
    modeRef.current = "ANSWER_ONLY";
    await runCountdown();
  };

  const onPrompterReady = () => {
    if (phase === "connecting") void runCountdown();
  };

  const pause = () => {
    const r = recRef.current;
    if (!r || r.state !== "recording" || !support.pause) return;
    r.pause();
    clock.current = { acc: now(), since: 0, running: false };
    setPhase("paused");
  };
  const resume = () => {
    const r = recRef.current;
    if (!r || r.state !== "paused") return;
    r.resume();
    clock.current = { acc: clock.current.acc, since: performance.now(), running: true };
    setPhase("recording");
  };
  const stop = () => {
    const r = recRef.current;
    audioRef.current?.pause();
    if (phase === "narrating" && modeRef.current === "CONTINUOUS") {
      markers.current.narrationEnd = now();
      setMic(true);
    }
    if (!r || r.state === "inactive") return;
    try {
      r.requestData();
    } catch {
      /* ignore */
    }
    r.stop();
    void wakeLock.current?.release();
  };
  const retake = () => {
    clock.current = { acc: 0, since: 0, running: false };
    setElapsed(0);
    setPhase("idle");
  };

  const limit = question.maxDurationSec ?? null;
  const over = limit != null && elapsed > limit;
  const up = lastClientId ? props.uploads[lastClientId] : null;
  const recordingLike = phase === "recording" || phase === "paused" || (phase === "narrating" && modeRef.current === "CONTINUOUS");
  const accent = session.theme?.accent ?? "#ffffff";
  const headerRow = (
    <div className="flex items-center justify-between pt-1">
      <button aria-label="Wróć do listy" className="-ml-2 flex h-10 items-center gap-1 rounded-xl px-2 text-sm text-white/80 disabled:opacity-30" disabled={recordingLike || phase === "countdown" || phase === "connecting"} onClick={props.onBack}>
        <ChevronLeft className="h-5 w-5" /> {isPrompter ? "Lista" : "Pytania"}
      </button>
      <span className="tabular text-xs font-medium text-white/60">
        {isPrompter ? "Skrypt" : "Pytanie"} {props.index + 1} z {props.total}
      </span>
      {recordingLike ? (
        <span className="flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-xs font-semibold tabular backdrop-blur">
          <span className={cn("h-2 w-2 rounded-full bg-rec", phase !== "paused" && "pulse-rec")} />
          {phase === "paused" ? "PAUZA" : "REC"} {formatDuration(elapsed)}
        </span>
      ) : (
        <span className="w-16" />
      )}
    </div>
  );

  return (
    <Shell>
      <div className="relative h-dvh w-full overflow-hidden bg-black">
        <CameraView stream={stream} mirrored={props.mirrored} fit={props.fit} />
        {phase === "idle" || phase === "review" ? (
          <button
            aria-label={props.fit === "cover" ? "Pokaż cały obraz z kamery" : "Wypełnij ekran"}
            className={cn("absolute right-4 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 backdrop-blur active:scale-95", isPrompter ? "top-[64%]" : "top-1/2")}
            onClick={() => props.onFit(props.fit === "cover" ? "contain" : "cover")}
          >
            {props.fit === "cover" ? <Shrink className="h-5 w-5" /> : <Expand className="h-5 w-5" />}
          </button>
        ) : null}
        <audio ref={audioRef} preload="auto" playsInline onEnded={onNarrationEnded} />

        {/* top: question overlay — in Prompter mode the text sits at the very top, right under the front camera */}
        <div
          className={cn("absolute inset-x-0 top-0 bg-gradient-to-b from-black/85 via-black/45 to-transparent pb-16", isPrompter ? "px-3" : "px-5 safe-top")}
          style={isPrompter ? { paddingTop: "max(4px, env(safe-area-inset-top))" } : undefined}
        >
          {isPrompter ? null : headerRow}
          {isPrompter ? (
            <div className="h-[46dvh]">
              {kind === "QUESTION_PROMPTER" ? (
                <p className="px-2 pb-1 pt-1 text-center text-[13px] font-semibold uppercase leading-snug text-white/75" data-testid="qp-question">
                  {question.text}
                </p>
              ) : null}
              <Prompter
                hook={kind === "QUESTION_PROMPTER" ? "" : question.text}
                script={question.script ?? null}
                takeKey={takeKey}
                armed={phase === "connecting" || phase === "countdown" || recordingLike}
                onReady={onPrompterReady}
                running={phase === "recording"}
                voiceAvailable={session.voiceFollow}
                recordToken={props.token}
                stream={stream}
                accent={accent}
                font={session.theme?.font ?? "Manrope"}
              />
            </div>
          ) : (
            <h1
              className="mt-4 text-balance text-center text-[25px] font-extrabold uppercase leading-[1.13] tracking-[-0.01em] [text-shadow:0_2px_16px_rgba(0,0,0,.45)]"
              style={{ fontFamily: `"${session.theme?.font ?? "Manrope"}", var(--font-display)` }}
            >
              {question.text}
            </h1>
          )}
          {isPrompter ? <div className="mt-1 px-2">{headerRow}</div> : null}
          {question.instructions && phase === "idle" ? <p className="mx-auto mt-3 max-w-sm text-center text-[13px] text-white/75">{question.instructions}</p> : null}
        </div>

        {/* center cues */}
        {phase === "narrating" ? (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
            <div className="flex items-center gap-2 rounded-full bg-black/55 px-4 py-2.5 text-sm font-medium backdrop-blur">
              <Volume2 className="h-4 w-4 animate-pulse" /> Lektor czyta pytanie…
            </div>
          </div>
        ) : null}
        {phase === "countdown" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
            <span key={countdown} className="font-display text-[120px] font-bold drop-shadow-xl">
              {countdown}
            </span>
          </div>
        ) : null}
        {answerCue ? (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
            <div className="flex items-center gap-2 rounded-full px-5 py-3 text-[15px] font-semibold text-black shadow-xl" style={{ background: accent }}>
              <Mic className="h-4 w-4" /> Twoja kolej — odpowiedz
            </div>
          </div>
        ) : null}

        {/* bottom controls */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-5 pt-20 safe-bottom">
          {recError ? <p className="mb-3 rounded-xl bg-red-500/20 px-3 py-2 text-center text-sm text-red-100">{recError}</p> : null}
          {narrationMsg && phase === "idle" ? <p className="mb-3 text-center text-xs text-white/60">{narrationMsg}</p> : null}
          {phase === "idle" ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-center text-[13px] text-white/70">
                {kind === "QUESTION_PROMPTER"
                  ? narrationState === "ready"
                    ? "Lektor przeczyta pytanie, potem odliczanie 3‑2‑1 i odpowiadasz z promptera — tekst przewija się za Twoim głosem."
                    : "Przeczytaj pytanie u góry, potem odliczanie 3‑2‑1 i odpowiadasz z promptera."
                  : isPrompter
                  ? session.voiceFollow
                    ? "Po odliczaniu 3‑2‑1 tekst przewija się za Twoim głosem. Stuknij słowo albo przewiń, żeby przeskoczyć."
                    : "Po odliczaniu 3‑2‑1 tekst przewija się w stałym tempie. Stuknij słowo albo przewiń, żeby przeskoczyć."
                  : narrationState === "loading"
                  ? "Przygotowuję lektora…"
                  : narrationState === "ready"
                    ? session.project.mode === "CONTINUOUS"
                      ? "Kamera ruszy, lektor przeczyta pytanie, a potem odpowiesz."
                      : "Najpierw wysłuchasz pytania, potem odliczanie 3‑2‑1."
                    : narrationState === "unavailable"
                      ? "Lektor nie jest skonfigurowany — przeczytaj pytanie i odpowiedz."
                      : "Nie udało się przygotować lektora — przeczytaj pytanie i odpowiedz."}
              </p>
              <button
                aria-label="Rozpocznij nagrywanie odpowiedzi"
                className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white/90 transition active:scale-95 disabled:opacity-40"
                disabled={(withNarrator && narrationState === "loading") || !stream}
                onClick={start}
              >
                <span className="h-14 w-14 rounded-full bg-rec" />
              </button>
              <span className="text-sm font-medium">{withNarrator && narrationState === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start"}</span>
            </div>
          ) : null}
          {phase === "connecting" ? (
            <div className="flex flex-col items-center gap-3 pb-2" data-testid="prompter-connecting">
              <p className="flex items-center gap-2 text-center text-[14px] text-white/85">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> Łączę ze śledzeniem głosu… nagrywanie ruszy, gdy ElevenLabs zacznie słuchać.
              </p>
              <button className="h-11 rounded-2xl bg-white/10 px-5 text-sm font-medium backdrop-blur" onClick={() => setPhase("idle")}>
                Anuluj
              </button>
            </div>
          ) : null}
          {phase === "narrating" || phase === "recording" || phase === "paused" ? (
            <div className="flex items-center justify-center gap-6 pb-2">
              {support.pause && phase !== "narrating" ? (
                phase === "paused" ? (
                  <RoundBtn label="Wznów" onClick={resume}>
                    <Play className="h-6 w-6" />
                  </RoundBtn>
                ) : (
                  <RoundBtn label="Pauza" onClick={pause}>
                    <Pause className="h-6 w-6" />
                  </RoundBtn>
                )
              ) : (
                <span className="w-14" />
              )}
              <button aria-label="Zatrzymaj" className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white/90 active:scale-95" onClick={stop}>
                <Square className="h-8 w-8 fill-rec text-rec" />
              </button>
              <div className={cn("tabular w-14 text-center text-sm font-semibold", over ? "text-amber-300" : "text-white/80")}>
                {formatDuration(elapsed)}
                {limit ? <div className="text-[10px] font-normal text-white/50">/ {formatDuration(limit)}</div> : null}
              </div>
            </div>
          ) : null}
          {phase === "review" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2 text-sm">
                {!props.online ? (
                  <span className="flex items-center gap-2 text-amber-200">
                    <WifiOff className="h-4 w-4" /> Brak internetu — nagranie zapisane w telefonie, wyślemy je automatycznie.
                  </span>
                ) : up?.status === "done" ? (
                  <span className="flex items-center gap-2 text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" /> Nagranie bezpiecznie zapisane
                  </span>
                ) : up?.status === "error" ? (
                  <span className="text-red-300">Wysyłanie nie powiodło się — ponowimy próbę.</span>
                ) : (
                  <span className="flex items-center gap-2 text-white/80">
                    <CloudUpload className="h-4 w-4" /> Wysyłanie {Math.round((up?.progress ?? 0) * 100)}%{up?.note ? ` · ${up.note}` : ""}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-white/10 font-semibold backdrop-blur active:scale-[.98]" onClick={retake}>
                  <RotateCcw className="h-5 w-5" /> Nagraj ponownie
                </button>
                <button className="h-14 rounded-2xl bg-white font-semibold text-black active:scale-[.98]" onClick={props.onNext}>
                  {isPrompter ? "Następny skrypt" : "Następne pytanie"}
                </button>
              </div>
              <button className="h-11 w-full rounded-2xl text-sm font-medium text-white/70" onClick={props.onFinish}>
                Zakończ nagrywanie
              </button>
            </div>
          ) : null}
        </div>
        {props.landscape ? <RotateHint /> : null}
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-[#0c0d10] text-white selection:bg-white/20">{children}</div>;
}

type Fit = "cover" | "contain";

/** Preview fit, remembered on the device. "contain" shows the whole camera frame (nothing cropped). */
function useFitPreference(): [Fit, (f: Fit) => void] {
  const [fit, setFitState] = useState<Fit>("contain");
  useEffect(() => {
    try {
      const v = localStorage.getItem("askby-camera-fit");
      if (v === "cover" || v === "contain") setFitState(v);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const setFit = (f: Fit) => {
    setFitState(f);
    try {
      localStorage.setItem("askby-camera-fit", f);
    } catch {
      /* ignore */
    }
  };
  return [fit, setFit];
}

function CameraAdjust({ stream, fit, onFit }: { stream: MediaStream | null; fit: Fit; onFit: (f: Fit) => void }) {
  const range = zoomRange(stream);
  const [zoom, setZoomValue] = useState<number | null>(null);
  const value = zoom ?? range?.value ?? 1;
  return (
    <div className="mb-3 space-y-2 rounded-2xl bg-black/45 p-3 backdrop-blur">
      <div className="flex items-center gap-2 text-[13px]">
        <span className="flex-1 text-white/80">Podgląd</span>
        <div className="flex rounded-xl bg-white/10 p-0.5">
          {(
            [
              ["contain", "Cały obraz"],
              ["cover", "Wypełnij ekran"],
            ] as const
          ).map(([v, l]) => (
            <button key={v} onClick={() => onFit(v)} className={cn("rounded-lg px-3 py-1.5 text-[13px] font-medium", fit === v ? "bg-white text-black" : "text-white/80")}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {range ? (
        <label className="flex items-center gap-3 text-[13px] text-white/80">
          <ZoomIn className="h-4 w-4 shrink-0" />
          <span className="shrink-0">Zoom kamery</span>
          <input
            type="range"
            className="w-full accent-white"
            min={range.min}
            max={range.max}
            step={range.step}
            value={value}
            onChange={(e) => {
              const v = Number(e.target.value);
              setZoomValue(v);
              void setZoom(stream, v);
            }}
          />
          <span className="tabular w-10 text-right">{value.toFixed(1)}×</span>
        </label>
      ) : null}
    </div>
  );
}

function CameraView({ stream, mirrored, fit = "contain" }: { stream: MediaStream | null; mirrored: boolean; fit?: Fit }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (stream) void v.play().catch(() => {});
  }, [stream]);
  // preview is mirrored like a mirror for the front camera; the server saves that recording mirrored too
  return <video ref={ref} className={cn("absolute inset-0 h-full w-full bg-black", fit === "cover" ? "object-cover" : "object-contain", mirrored && "-scale-x-100")} muted playsInline autoPlay />;
}

/**
 * Where the face should be: slightly left of centre and in the upper third — the right edge
 * (TikTok / Reels buttons) and the lower part (captions, description) stay free on the video.
 */
function FaceGuide({ mirrored }: { mirrored: boolean }) {
  // front-camera recordings are saved mirrored (as seen in the preview), so the guide on the left
  // means the face is on the left in the finished video too
  void mirrored;
  const cx = 38;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 90 160" preserveAspectRatio="xMidYMid slice" aria-hidden data-testid="face-guide" data-cx={cx}>
      <defs>
        <mask id="face">
          <rect width="90" height="160" fill="white" />
          <ellipse cx={cx} cy="54" rx="20" ry="27" fill="black" />
        </mask>
      </defs>
      <rect width="90" height="160" fill="rgba(0,0,0,.35)" mask="url(#face)" />
      <ellipse cx={cx} cy="54" rx="20" ry="27" fill="none" stroke="white" strokeOpacity=".8" strokeWidth=".5" strokeDasharray="2 1.5" />
      <line x1="6" y1="28" x2="72" y2="28" stroke="white" strokeOpacity=".25" strokeWidth=".25" />
    </svg>
  );
}

function RotateHint() {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/85 px-8 text-center">
      <p className="text-lg font-semibold">Obróć telefon pionowo, aby nagrywać w formacie 9:16.</p>
    </div>
  );
}

function RoundBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button aria-label={label} className="flex h-14 w-14 flex-col items-center justify-center rounded-full bg-white/15 backdrop-blur active:scale-95" onClick={onClick}>
      {children}
    </button>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-white/[.06] p-4">
      <div className="text-xs text-white/50">{label}</div>
      <div className="tabular mt-1 font-display text-2xl font-semibold">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-white/45">{sub}</div> : null}
    </div>
  );
}

function Num({ n }: { n: number }) {
  return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">{n}</span>;
}

function UploadBanner({ uploads, online, onRetry }: { uploads: Record<string, UploadState>; online: boolean; onRetry: () => void }) {
  const list = Object.values(uploads);
  const active = list.filter((u) => u.status === "uploading" || u.status === "queued");
  const failed = list.filter((u) => u.status === "error");
  if (!online) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-2xl bg-amber-500/15 px-4 py-3 text-sm text-amber-100">
        <WifiOff className="h-4 w-4" /> Brak połączenia. Nagrania są zapisane w telefonie i zostaną wysłane automatycznie.
      </div>
    );
  }
  if (failed.length) {
    return (
      <button onClick={onRetry} className="mt-4 flex w-full items-center gap-2 rounded-2xl bg-red-500/15 px-4 py-3 text-left text-sm text-red-100">
        <RefreshCw className="h-4 w-4" /> Nie udało się wysłać {failed.length} {plural(failed.length, "nagrania", "nagrań", "nagrań")}. Dotknij, aby ponowić.
      </button>
    );
  }
  if (active.length) {
    const p = active.reduce((n, u) => n + u.progress, 0) / active.length;
    return (
      <div className="mt-4 rounded-2xl bg-white/[.06] px-4 py-3 text-sm">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Wysyłanie nagrań… {Math.round(p * 100)}%
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-white transition-all" style={{ width: `${p * 100}%` }} />
        </div>
      </div>
    );
  }
  return null;
}

/** Top-right: the expert's films in editing / approved (shown only when there are some). */
function VideosButton({ count, onClick }: { count: number; onClick: () => void }) {
  if (!count) return null;
  return (
    <button onClick={onClick} className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-medium text-white active:scale-[.97]" data-testid="videos-button">
      <Play className="h-3.5 w-3.5" /> Twoje filmy <span className="tabular rounded-full bg-white/15 px-1.5 text-[11px]">{count}</span>
    </button>
  );
}

interface VideoSource {
  url: string;
  kind: "export" | "older-export" | "recording";
  rendering: boolean;
  progress: number;
}

/** Full-screen list of the expert's films; each opens the CURRENT edit (rendered on demand). */
function VideosSheet({ token, videos, onClose }: { token: string; videos: ExpertVideo[]; onClose: () => void }) {
  const [watching, setWatching] = useState<ExpertVideo | null>(null);
  const [src, setSrc] = useState<VideoSource | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!watching) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const res = await fetch(`/api/record/${token}/videos/${watching.questionId}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (stopped) return;
        if (!res.ok) throw new Error(data.error ?? `Błąd HTTP ${res.status}`);
        // keep playing the interim version until the current edit is ready, then switch
        setSrc((prev) => (prev && data.rendering && prev.url ? { ...prev, progress: data.progress } : data));
        if (data.rendering) timer = setTimeout(load, 4000);
      } catch (e) {
        if (!stopped) setErr((e as Error).message);
      }
    };
    setSrc(null);
    setErr(null);
    void load();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [watching, token]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#0c0d10] safe-top safe-bottom" data-testid="videos-sheet">
      {watching ? (
        <div className="flex h-dvh flex-col bg-black" data-testid="expert-video-player">
          <div className="flex items-center gap-3 px-4 py-3">
            <button onClick={() => setWatching(null)} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10" aria-label="Zamknij film">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <p className="min-w-0 flex-1 truncate text-[14px] font-medium">{watching.text}</p>
          </div>
          {src?.rendering ? (
            <p className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-sky-400/15 px-3 py-2 text-[12.5px] text-sky-200" data-testid="video-rendering">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              Przygotowuję aktualną wersję montażu{src.progress > 0 ? ` (${Math.round(src.progress * 100)}%)` : ""}… Na razie {src.kind === "older-export" ? "poprzednia wersja" : "Twoje nagranie"}.
            </p>
          ) : null}
          {err ? <p className="mx-4 text-[13px] text-red-300">{err}</p> : null}
          {src?.url ? <video key={src.url} src={src.url} controls autoPlay playsInline className="min-h-0 w-full flex-1 bg-black object-contain" /> : !err ? <Loader2 className="m-auto h-6 w-6 animate-spin text-white/60" /> : null}
        </div>
      ) : (
        <div className="mx-auto max-w-md px-5 pb-10 pt-4">
          <div className="mb-5 flex items-center gap-3">
            <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10" aria-label="Wróć">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h1 className="font-display text-2xl font-semibold">Twoje filmy</h1>
          </div>
          <div className="space-y-2" data-testid="expert-videos">
            {videos.map((v) => (
              <button key={v.questionId} onClick={() => setWatching(v)} className="flex w-full items-center gap-3 rounded-2xl bg-white/[.07] p-3 text-left active:scale-[.99]" data-testid="expert-video">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black">
                  <Play className="ml-0.5 h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("mb-1 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em]", v.status === "APPROVED" ? "bg-emerald-400/20 text-emerald-300" : "bg-sky-400/20 text-sky-300")}>
                    {v.status === "APPROVED" ? "Zatwierdzone" : "W trakcie montażu"}
                  </span>
                  <span className="block truncate text-[15px] font-medium">{v.text}</span>
                  <span className="block text-[12px] text-white/45">{v.category}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
