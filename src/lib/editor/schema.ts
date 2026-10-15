/** Runtime validation of editor documents received from the browser before they are persisted. */
import { z } from "zod";

const num = z.number().finite();
const color = z.string().max(64).regex(/^(#[0-9a-fA-F]{3,8}|\$[a-z]+|rgba?\([0-9.,\s%]+\)|transparent)$/);
const font = z.string().max(64);

const theme = z.object({
  name: z.string().max(120),
  primary: color,
  accent: color,
  secondary: color,
  text: color,
  highlight: color,
  background: color,
  questionFont: font,
  subtitleFont: font,
  labelFont: font,
  logoAssetId: z.string().max(64).nullable().optional(),
});

const avClip = z.object({
  id: z.string().max(64),
  assetId: z.string().max(64),
  sourceIn: num.min(0),
  sourceOut: num.min(0),
  start: num.min(0),
  volume: num.min(0).max(4),
  muted: z.boolean(),
  framing: z.object({ scale: num.min(1).max(4), cx: num.min(0).max(1), cy: num.min(0).max(1) }),
  label: z.string().max(120).optional(),
  audioAssetId: z.string().max(64).nullable().optional(),
});

const audioClip = z.object({
  id: z.string().max(64),
  assetId: z.string().max(64),
  kind: z.enum(["narration", "music"]),
  start: num.min(0),
  sourceIn: num.min(0),
  sourceOut: num.min(0),
  volume: num.min(0).max(4),
  muted: z.boolean(),
  fadeIn: num.min(0).max(30),
  fadeOut: num.min(0).max(30),
  label: z.string().max(120).optional(),
});

const zoom = z.object({
  id: z.string().max(64),
  start: num.min(0),
  end: num.min(0),
  fromScale: num.min(1).max(3),
  toScale: num.min(1).max(3),
  cx: num.min(0).max(1),
  cy: num.min(0).max(1),
  type: z.enum(["smooth-in", "smooth-out", "jump-in", "jump-out", "push-in"]),
  easing: z.enum(["linear", "easeIn", "easeOut", "easeInOut", "step"]),
  suggested: z.boolean().optional(),
});

const overlayBase = {
  id: z.string().max(64),
  name: z.string().max(120),
  start: num.min(0),
  end: num.min(0).nullable(),
  x: num.min(-1).max(2),
  y: num.min(-1).max(2),
  w: num.min(0.01).max(3),
  h: num.min(0).max(3),
  opacity: num.min(0).max(1),
  animation: z.enum(["none", "fade", "pop", "slide", "slideDown", "slideLeft", "zoom"]),
  hidden: z.boolean().optional(),
};

const textStyle = z.object({
  fontFamily: font,
  fontSize: num.min(6).max(400),
  fontWeight: z.number().int().min(100).max(900),
  color,
  align: z.enum(["left", "center", "right"]),
  lineHeight: num.min(0.6).max(3),
  letterSpacing: num.min(-20).max(60),
  background: color.nullable(),
  backgroundOpacity: num.min(0).max(1),
  padding: num.min(0).max(200),
  radius: num.min(0).max(200),
  shadow: num.min(0).max(100),
  uppercase: z.boolean(),
});

const overlay = z.discriminatedUnion("kind", [
  z.object({ ...overlayBase, kind: z.literal("text"), role: z.enum(["question", "label", "custom"]), text: z.string().max(2000), style: textStyle }),
  z.object({ ...overlayBase, kind: z.enum(["rect", "ellipse", "highlight"]), fill: color.nullable(), stroke: color.nullable(), strokeWidth: num.min(0).max(60), radius: num.min(0).max(500) }),
  z.object({ ...overlayBase, kind: z.enum(["callout", "lowerThird"]), title: z.string().max(300), subtitle: z.string().max(300), fill: color, accent: color, textColor: color, fontFamily: font, titleSize: num.min(8).max(300).optional(), subtitleSize: num.min(6).max(300).optional() }),
  z.object({ ...overlayBase, kind: z.enum(["image", "logo"]), assetId: z.string().max(64).nullable(), fit: z.enum(["contain", "cover"]) }),
  z.object({ ...overlayBase, kind: z.literal("video"), assetId: z.string().max(64), fit: z.enum(["contain", "cover"]), sourceIn: num.min(0), loop: z.boolean(), volume: num.min(0).max(2), radius: num.min(0).max(500) }),
]);

const subStyle = z.object({
  fontFamily: font,
  fontSize: num.min(10).max(300),
  fontWeight: z.number().int().min(100).max(900),
  color,
  highlightColor: color,
  highlightMode: z.enum(["none", "color", "box"]),
  case: z.enum(["normal", "upper", "lower"]),
  y: num.min(0).max(1),
  maxWidth: num.min(0.2).max(1),
  background: color.nullable(),
  backgroundOpacity: num.min(0).max(1),
  stroke: num.min(0).max(30),
  shadow: num.min(0).max(100),
  animation: z.enum(["none", "pop", "fade"]),
  lineHeight: num.min(0.6).max(3),
});

export const EditorDocumentSchema = z.object({
  version: z.number().int(),
  width: z.number().int().min(16).max(4096),
  height: z.number().int().min(16).max(4096),
  fps: z.number().int().min(1).max(60),
  theme,
  background: color,
  clips: z.array(avClip).max(2000),
  narration: z.array(audioClip).max(200),
  music: z.array(audioClip).max(200),
  zooms: z.array(zoom).max(1000),
  overlays: z.array(overlay).max(300),
  subtitles: z.object({
    enabled: z.boolean(),
    preset: z.enum(["minimal-white", "bold-social", "dynamic-highlight", "elegant-premium", "clean-corporate"]),
    style: subStyle,
    source: z.enum(["none", "transcript", "edited"]),
    segments: z
      .array(
        z.object({
          id: z.string().max(64),
          assetId: z.string().max(64),
          words: z.array(z.object({ id: z.string().max(64), text: z.string().max(200), start: num.min(0), end: num.min(0) })).max(400),
        }),
      )
      .max(5000),
  }),
  pauses: z
    .array(z.object({ id: z.string().max(64), assetId: z.string().max(64), start: num, end: num, confidence: num, status: z.enum(["pending", "accepted", "rejected", "applied"]) }))
    .max(5000),
  meta: z.object({
    questionText: z.string().max(2000),
    mode: z.enum(["CONTINUOUS", "ANSWER_ONLY"]),
    narrationStart: num.nullable().optional(),
    narrationEnd: num.nullable().optional(),
    pauseSensitivity: z.enum(["gentle", "standard", "dynamic"]),
    pausePadding: num.min(0).max(2),
    showSafeArea: z.enum(["tiktok", "reels", "shorts", "none"]).optional(),
    aiBroll: z
      .array(
        z.object({
          id: z.string().max(64),
          start: num.min(0),
          end: num.min(0),
          quote: z.string().max(2000),
          title: z.string().max(200),
          reason: z.string().max(1000),
          prompt: z.string().max(2500),
          duration: num.min(1).max(30),
          model: z.string().max(120),
          status: z.enum(["suggested", "generating", "done", "failed"]),
          jobId: z.string().max(64).nullable().optional(),
          overlayId: z.string().max(64).nullable().optional(),
          error: z.string().max(1000).nullable().optional(),
        }),
      )
      .max(50)
      .optional(),
  }),
});
