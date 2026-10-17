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
  questionStyle: z.string().max(20).optional(),
  questionPosition: z.string().max(20).optional(),
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
  background: z.object({ blur: num.min(0).max(100), imageAssetId: z.string().max(64).nullable().optional(), imageBlur: num.min(0).max(100).optional(), despill: z.boolean().optional() }).optional(),
  look: z.object({ brightness: num.min(0.5).max(2), contrast: num.min(0.5).max(2), saturate: num.min(0).max(3) }).optional(),
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
  speed: num.min(0.5).max(2).optional(),
  baseAssetId: z.string().max(64).optional(),
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
  outline: num.min(0).max(40).optional(),
  accentBar: z.boolean().optional(),
});

const overlay = z.discriminatedUnion("kind", [
  z.object({ ...overlayBase, kind: z.literal("text"), role: z.enum(["question", "label", "custom"]), text: z.string().max(2000), style: textStyle, themeStyle: z.string().max(40).optional() }),
  z.object({ ...overlayBase, kind: z.enum(["rect", "ellipse", "highlight"]), fill: color.nullable(), stroke: color.nullable(), strokeWidth: num.min(0).max(60), radius: num.min(0).max(500) }),
  z.object({ ...overlayBase, kind: z.enum(["callout", "lowerThird"]), title: z.string().max(300), subtitle: z.string().max(300), fill: color, accent: color, textColor: color, fontFamily: font, titleSize: num.min(8).max(300).optional(), subtitleSize: num.min(6).max(300).optional() }),
  z.object({
    ...overlayBase,
    kind: z.enum(["image", "logo"]),
    assetId: z.string().max(64).nullable(),
    fit: z.enum(["contain", "cover"]),
    bubble: z.object({ x: num.min(0).max(1), y: num.min(0).max(1), size: num.min(0.08).max(0.9), zoom: num.min(0.5).max(4).optional(), fy: num.min(0).max(1).optional() }).optional(),
  }),
  z.object({ ...overlayBase, kind: z.literal("blur"), shape: z.enum(["rect", "circle"]), strength: num.min(0).max(100), radius: num.min(0).max(500) }),
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
          y: num.min(0).max(1).nullable().optional(),
        }),
      )
      .max(5000),
  }),
  pauses: z
    .array(z.object({ id: z.string().max(64), assetId: z.string().max(64), start: num, end: num, confidence: num, status: z.enum(["pending", "accepted", "rejected", "applied"]) }))
    .max(5000),
  endCard: z.object({ seconds: num.min(1).max(10), url: z.string().max(200), text: z.string().max(200).nullable(), placement: z.enum(["append", "overlay"]).optional(), custom: z.boolean().optional() }).optional(),
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
          kind: z.enum(["video", "infographic", "illustration"]).optional(),
          passage: z.string().max(4000).optional(),
          variants: z.array(z.string().max(64)).max(6).optional(),
          start: num.min(0),
          end: num.min(0),
          quote: z.string().max(2000),
          title: z.string().max(200),
          reason: z.string().max(1000),
          prompt: z.string().max(2500),
          duration: num.min(1).max(30),
          model: z.string().max(120),
          status: z.enum(["suggested", "generating", "done", "failed"]),
          imagePrompt: z.string().max(3000).optional(),
          illustration: z.boolean().optional(),
          illustrationSource: z.enum(["higgsfield", "openai"]).optional(),
          engine: z.enum(["template", "openai"]).optional(),
          infographic: z
            .object({
              headline: z.string().max(200),
              items: z.array(z.object({ value: z.string().max(60), label: z.string().max(240) })).max(6),
              note: z.string().max(300).nullable().optional(),
            })
            .optional(),
          warning: z.string().max(1000).nullable().optional(),
          jobId: z.string().max(64).nullable().optional(),
          overlayId: z.string().max(64).nullable().optional(),
          error: z.string().max(1000).nullable().optional(),
        }),
      )
      .max(50)
      .optional(),
    autoVisuals: z.string().max(20).optional(),
    autoPolish: z.string().max(20).optional(),
    bgVariants: z.array(z.string().max(64)).max(24).optional(),
  }),
});
