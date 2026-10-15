import type { AudioClip, AVClip, EditorDocument, Overlay, PauseSuggestion, SubtitleSegment, TextOverlay, ThemeTokens } from "./types";
import { DOC_VERSION } from "./types";
import { SUBTITLE_PRESETS } from "./subtitles";
import { uid } from "./id";

export const EXPORT_FORMATS = {
  "1080x1920": { width: 1080, height: 1920, label: "9:16 — 1080 × 1920 (domyślny)" },
  "720x1280": { width: 720, height: 1280, label: "9:16 — 720 × 1280" },
  "1920x1080": { width: 1920, height: 1080, label: "16:9 — 1920 × 1080" },
  "1080x1080": { width: 1080, height: 1080, label: "1:1 — 1080 × 1080" },
} as const;
export type ExportFormat = keyof typeof EXPORT_FORMATS;

export function questionOverlay(text: string, start: number, end: number | null): TextOverlay {
  return {
    id: uid("ovl"),
    kind: "text",
    role: "question",
    name: "Pytanie",
    text,
    start,
    end,
    x: 0.07,
    y: 0.085,
    w: 0.86,
    h: 0.1,
    opacity: 1,
    animation: "slideDown",
    style: {
      fontFamily: "$question",
      fontSize: 58,
      fontWeight: 800,
      color: "$text",
      align: "center",
      lineHeight: 1.16,
      letterSpacing: 0,
      background: "$primary",
      backgroundOpacity: 0.9,
      padding: 30,
      radius: 26,
      shadow: 24,
      uppercase: true,
    },
  };
}

export interface BuildInput {
  questionText: string;
  theme: ThemeTokens;
  mode: "CONTINUOUS" | "ANSWER_ONLY";
  recording: { assetId: string; duration: number };
  narration?: { assetId: string; duration: number } | null;
  /** Mode A: when the narration played inside the recording (source seconds). */
  narrationWindow?: { start: number; end: number } | null;
  segments: SubtitleSegment[];
  pauses: Array<Omit<PauseSuggestion, "id" | "status" | "assetId">>;
  visibility: "NARRATION_ONLY" | "FIRST_SECONDS" | "FULL";
  questionSeconds: number;
  logo?: boolean;
}

/** Build the initial editable composition for a recorded answer (pipeline step 9–14). */
export function buildInitialDocument(input: BuildInput): EditorDocument {
  const clips: AVClip[] = [];
  const narration: AudioClip[] = [];
  let answerStart = 0;
  const framing = { scale: 1, cx: 0.5, cy: 0.42 };

  if (input.mode === "CONTINUOUS") {
    // Mode A: the camera was rolling while the question played; the mic was muted
    // during narration so the TTS is inserted from its own clean asset instead.
    const win = input.narrationWindow;
    const nEnd = win ? Math.min(win.end, input.recording.duration) : 0;
    if (win && nEnd > 0.05) {
      clips.push({ id: uid("clip"), assetId: input.recording.assetId, sourceIn: 0, sourceOut: nEnd, start: 0, volume: 1, muted: true, framing, label: "Słuchanie pytania" });
      clips.push({ id: uid("clip"), assetId: input.recording.assetId, sourceIn: nEnd, sourceOut: input.recording.duration, start: nEnd, volume: 1, muted: false, framing, label: "Odpowiedź" });
      answerStart = nEnd;
      if (input.narration) {
        narration.push({
          id: uid("aud"),
          assetId: input.narration.assetId,
          kind: "narration",
          start: Math.max(0, win.start),
          sourceIn: 0,
          sourceOut: Math.min(input.narration.duration, Math.max(0.1, win.end - win.start + 0.05)),
          volume: 1,
          muted: false,
          fadeIn: 0,
          fadeOut: 0.05,
          label: "Lektor ElevenLabs",
        });
      }
    } else {
      clips.push({ id: uid("clip"), assetId: input.recording.assetId, sourceIn: 0, sourceOut: input.recording.duration, start: 0, volume: 1, muted: false, framing, label: "Odpowiedź" });
    }
  } else {
    // Mode B: intro card with the narration, then the answer
    const intro = input.narration ? input.narration.duration + 0.4 : 0;
    if (input.narration) {
      narration.push({
        id: uid("aud"),
        assetId: input.narration.assetId,
        kind: "narration",
        start: 0.2,
        sourceIn: 0,
        sourceOut: input.narration.duration,
        volume: 1,
        muted: false,
        fadeIn: 0,
        fadeOut: 0.05,
        label: "Lektor ElevenLabs",
      });
    }
    const start = Math.round(intro * 30) / 30;
    clips.push({ id: uid("clip"), assetId: input.recording.assetId, sourceIn: 0, sourceOut: input.recording.duration, start, volume: 1, muted: false, framing, label: "Odpowiedź" });
    answerStart = start;
  }

  let qEnd: number | null = null;
  if (input.visibility === "NARRATION_ONLY") qEnd = Math.max(1.5, answerStart);
  else if (input.visibility === "FIRST_SECONDS") qEnd = answerStart + input.questionSeconds;
  const overlays: Overlay[] = [questionOverlay(input.questionText, 0, qEnd)];
  if (input.logo && input.theme.logoAssetId) {
    overlays.push({
      id: uid("ovl"),
      kind: "logo",
      name: "Logo",
      assetId: null,
      fit: "contain",
      start: 0,
      end: null,
      x: 0.39,
      y: 0.9,
      w: 0.22,
      h: 0.05,
      opacity: 0.95,
      animation: "fade",
    });
  }

  const preset = SUBTITLE_PRESETS["dynamic-highlight"];
  return {
    version: DOC_VERSION,
    width: 1080,
    height: 1920,
    fps: 30,
    theme: input.theme,
    background: "$background",
    clips,
    narration,
    music: [],
    zooms: [],
    overlays,
    subtitles: { enabled: true, preset: "dynamic-highlight", style: { ...preset.style }, segments: input.segments, source: input.segments.length ? "transcript" : "none" },
    pauses: input.pauses.map((p) => ({ ...p, id: uid("pause"), assetId: input.recording.assetId, status: "pending" as const })),
    meta: {
      questionText: input.questionText,
      mode: input.mode,
      narrationStart: input.narrationWindow?.start ?? null,
      narrationEnd: input.narrationWindow?.end ?? null,
      pauseSensitivity: "standard",
      pausePadding: 0.2,
      showSafeArea: "tiktok",
    },
  };
}
