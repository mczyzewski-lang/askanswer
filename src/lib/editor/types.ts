/**
 * Editor document model — the single source of truth for a video composition.
 *
 * All editing is non-destructive: clips reference immutable source media by
 * asset id plus in/out points. The final video is reconstructed from these
 * instructions both in the browser preview and in the server-side renderer,
 * using the same drawing code (src/lib/render/compositor.ts).
 *
 * Time values are seconds (float). Timeline time ("t") is the time in the
 * edited composition; source time is the time inside a media asset.
 *
 * Colors may be literal ("#RRGGBB") or theme references ("$accent", ...).
 * Fonts may be literal family names or theme references ("$question", ...).
 */

export const DOC_VERSION = 1;

export type ThemeColorToken =
  | "$primary"
  | "$accent"
  | "$secondary"
  | "$text"
  | "$highlight"
  | "$background";
export type ColorRef = string; // "#hex" | "rgba(...)" | ThemeColorToken
export type FontRef = string; // family | "$question" | "$subtitle" | "$label"

export interface ThemeTokens {
  name: string;
  primary: string;
  accent: string;
  secondary: string;
  text: string;
  highlight: string;
  background: string;
  questionFont: string;
  subtitleFont: string;
  labelFont: string;
  logoAssetId?: string | null;
}

/** Linked expert video + microphone audio. Shown on two timeline rows but edited together, so they never drift. */
export interface AVClip {
  id: string;
  assetId: string;
  sourceIn: number;
  sourceOut: number;
  start: number;
  volume: number; // 0..2
  muted: boolean;
  /** Base framing (crop/reposition). scale >= 1, centre in normalized source coords. */
  framing: { scale: number; cx: number; cy: number };
  /** Background behind the expert: blur strength 0 (off) .. 100, via the recording's person mask. */
  background?: { blur: number };
  label?: string;
  /** Optional replacement audio with identical timing (e.g. enhanced voice). Video stays from assetId. */
  audioAssetId?: string | null;
}

export interface AudioClip {
  id: string;
  assetId: string;
  kind: "narration" | "music";
  start: number;
  sourceIn: number;
  sourceOut: number;
  volume: number;
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  label?: string;
}

export type ZoomType = "smooth-in" | "smooth-out" | "jump-in" | "jump-out" | "push-in";
export type Easing = "linear" | "easeIn" | "easeOut" | "easeInOut" | "step";

export interface ZoomEffect {
  id: string;
  start: number;
  end: number;
  fromScale: number;
  toScale: number;
  cx: number; // 0..1, crop centre
  cy: number;
  type: ZoomType;
  easing: Easing;
  suggested?: boolean; // created by "Zaproponuj dynamiczne zbliżenia", awaiting review
}

export interface TextStyle {
  fontFamily: FontRef;
  fontSize: number; // design px on a 1080-wide canvas
  fontWeight: number;
  color: ColorRef;
  align: "left" | "center" | "right";
  lineHeight: number; // multiplier
  letterSpacing: number; // px
  background: ColorRef | null;
  backgroundOpacity: number;
  padding: number;
  radius: number;
  shadow: number; // blur px, 0 = none
  uppercase: boolean;
}

export type OverlayAnimation = "none" | "fade" | "pop" | "slide" | "slideDown" | "slideLeft" | "zoom";

interface OverlayBase {
  id: string;
  name: string;
  start: number;
  end: number | null; // null = until the end of the composition
  x: number; // left edge, normalized 0..1
  y: number; // top edge, normalized 0..1
  w: number; // width, normalized
  h: number; // height, normalized (ignored for text, which grows with its content)
  opacity: number;
  animation: OverlayAnimation;
  hidden?: boolean;
}

export interface TextOverlay extends OverlayBase {
  kind: "text";
  role: "question" | "label" | "custom";
  text: string;
  style: TextStyle;
}

export interface ShapeOverlay extends OverlayBase {
  kind: "rect" | "ellipse" | "highlight";
  fill: ColorRef | null;
  stroke: ColorRef | null;
  strokeWidth: number;
  radius: number;
}

export interface CalloutOverlay extends OverlayBase {
  kind: "callout" | "lowerThird";
  title: string;
  subtitle: string;
  fill: ColorRef;
  accent: ColorRef;
  textColor: ColorRef;
  fontFamily: FontRef;
  /** Font sizes in design px (1080-wide canvas); when absent, derived from the box height. */
  titleSize?: number;
  subtitleSize?: number;
}

export interface ImageOverlay extends OverlayBase {
  kind: "image" | "logo";
  assetId: string | null; // null + kind=logo => theme logo
  fit: "contain" | "cover";
}

/** Uploaded video placed as its own layer (picture-in-picture, B-roll, animated graphic). */
export interface VideoOverlay extends OverlayBase {
  kind: "video";
  assetId: string;
  fit: "contain" | "cover";
  sourceIn: number; // where the clip starts inside the uploaded file
  loop: boolean;
  volume: number; // 0 = muted
  radius: number;
}

export type Overlay = TextOverlay | ShapeOverlay | CalloutOverlay | ImageOverlay | VideoOverlay;

export interface SubWord {
  id: string;
  text: string;
  start: number; // SOURCE time of the referenced asset
  end: number;
}

export interface SubtitleSegment {
  id: string;
  assetId: string;
  words: SubWord[];
}

export type SubtitlePresetKey = "minimal-white" | "bold-social" | "dynamic-highlight" | "elegant-premium" | "clean-corporate";

export interface SubtitleStyle {
  fontFamily: FontRef;
  fontSize: number;
  fontWeight: number;
  color: ColorRef;
  highlightColor: ColorRef;
  highlightMode: "none" | "color" | "box";
  case: "normal" | "upper" | "lower";
  y: number; // normalized vertical centre of the subtitle block
  maxWidth: number; // normalized
  background: ColorRef | null;
  backgroundOpacity: number;
  stroke: number; // outline width in design px
  shadow: number;
  animation: "none" | "pop" | "fade";
  lineHeight: number;
}

export interface SubtitleTrack {
  enabled: boolean;
  preset: SubtitlePresetKey;
  style: SubtitleStyle;
  segments: SubtitleSegment[];
  source: "none" | "transcript" | "edited";
}

export interface PauseSuggestion {
  id: string;
  assetId: string;
  start: number; // SOURCE time
  end: number;
  confidence: number;
  status: "pending" | "accepted" | "rejected" | "applied";
}

export interface EditorDocument {
  version: number;
  width: number;
  height: number;
  fps: number;
  theme: ThemeTokens;
  background: ColorRef;
  clips: AVClip[];
  narration: AudioClip[];
  music: AudioClip[];
  zooms: ZoomEffect[];
  overlays: Overlay[];
  subtitles: SubtitleTrack;
  pauses: PauseSuggestion[];
  meta: {
    questionText: string;
    mode: "CONTINUOUS" | "ANSWER_ONLY";
    narrationStart?: number | null; // source time inside the recording (mode A)
    narrationEnd?: number | null;
    pauseSensitivity: "gentle" | "standard" | "dynamic";
    pausePadding: number;
    showSafeArea?: "tiktok" | "reels" | "shorts" | "none";
    /** AI B-roll proposals and generations (Higgsfield), kept with the video so they survive a reload. */
    aiBroll?: AiBrollItem[];
  };
}

export interface AiBrollItem {
  id: string;
  /** full-screen AI video scene, or an infographic image (absent = video, for older documents) */
  kind?: "video" | "infographic";
  start: number; // timeline seconds
  end: number;
  quote: string;
  title: string;
  reason: string;
  prompt: string;
  duration: number; // seconds requested from the video model
  model: string;
  status: "suggested" | "generating" | "done" | "failed";
  /** infographic: background illustration prompt and content */
  imagePrompt?: string;
  illustration?: boolean;
  infographic?: { headline: string; items: Array<{ value: string; label: string }>; note?: string | null };
  warning?: string | null;
  jobId?: string | null;
  overlayId?: string | null;
  error?: string | null;
}

export interface AssetInfo {
  id: string;
  kind: string;
  url: string;
  /** WebM preview proxy for browsers without H.264 decoding (never used for export). */
  proxyUrl?: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
  waveform?: Waveform | null;
  label?: string;
  /** For enhanced audio: which enhancement produced it ("podcast" | "isolator"). */
  variant?: string | null;
  /** For enhanced audio: strength of the mastering ("natural" | "podcast" | "radio"). */
  strength?: string | null;
  /** For narration: the ElevenLabs voice it was generated with. */
  voiceId?: string | null;
  /** Recordings: person mask (AMSK file) for background blur, once computed. */
  maskUrl?: string | null;
}

export interface Waveform {
  rate: number; // values per second
  peaks: number[]; // 0..1
  rmsDb: number[]; // dBFS per window
}
