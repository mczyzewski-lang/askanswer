/** Browser media helpers with explicit feature detection (never silently assume support). */

export interface RecorderSupport {
  mediaDevices: boolean;
  mediaRecorder: boolean;
  pause: boolean;
  mimeType: string | null;
}

const CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4",
];

export function detectSupport(): RecorderSupport {
  const hasMD = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const hasMR = typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined";
  let mimeType: string | null = null;
  if (hasMR) {
    const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
    const list = isSafari ? [...CANDIDATES.slice(3), ...CANDIDATES.slice(0, 3)] : CANDIDATES;
    for (const c of list) {
      try {
        if (MediaRecorder.isTypeSupported(c)) {
          mimeType = c;
          break;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return {
    mediaDevices: hasMD,
    mediaRecorder: hasMR,
    pause: hasMR && typeof MediaRecorder.prototype.pause === "function" && typeof MediaRecorder.prototype.resume === "function",
    mimeType,
  };
}

export type Facing = "user" | "environment";

/**
 * Request camera + mic. We deliberately do NOT force a 9:16 aspect ratio or a
 * 1080×1920 size: on many phones (notably iPhone front cameras) that makes the
 * browser crop the sensor, which looks heavily zoomed in. A 16:9 request keeps
 * the widest field of view; the 9:16 framing is done later in the editor.
 */
export async function openCamera(facing: Facing): Promise<MediaStream> {
  const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
  const attempts: MediaStreamConstraints[] = [
    { video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 }, resizeMode: "none" } as MediaTrackConstraints, audio },
    { video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio },
    { video: { facingMode: facing }, audio: true },
    { video: true, audio: true },
  ];
  let lastErr: unknown = null;
  for (const c of attempts) {
    try {
      const s = await navigator.mediaDevices.getUserMedia(c);
      await setZoom(s, "min");
      return s;
    } catch (e) {
      lastErr = e;
      const name = (e as DOMException).name;
      // permission problems will not be fixed by relaxing constraints
      if (name === "NotAllowedError" || name === "SecurityError" || name === "NotFoundError") break;
    }
  }
  throw lastErr;
}

export interface ZoomRange {
  min: number;
  max: number;
  step: number;
  value: number;
}

/** Optical/digital zoom range of the camera, if the browser exposes it (Chrome on Android does; iOS Safari mostly not). */
export function zoomRange(s: MediaStream | null): ZoomRange | null {
  const t = s?.getVideoTracks()[0];
  if (!t || typeof t.getCapabilities !== "function") return null;
  const caps = t.getCapabilities() as MediaTrackCapabilities & { zoom?: { min: number; max: number; step?: number } };
  if (!caps.zoom || caps.zoom.max <= caps.zoom.min) return null;
  const cur = (t.getSettings() as MediaTrackSettings & { zoom?: number }).zoom ?? caps.zoom.min;
  return { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1, value: cur };
}

export async function setZoom(s: MediaStream | null, value: number | "min"): Promise<void> {
  const t = s?.getVideoTracks()[0];
  const r = zoomRange(s ?? null);
  if (!t || !r) return;
  const v = value === "min" ? r.min : Math.min(r.max, Math.max(r.min, value));
  try {
    await t.applyConstraints({ advanced: [{ zoom: v } as MediaTrackConstraintSet] });
  } catch {
    /* zoom not adjustable on this device */
  }
}

export function cameraErrorMessage(e: unknown): string {
  const name = (e as DOMException)?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Brak dostępu do kamery lub mikrofonu. Zezwól na dostęp w ustawieniach przeglądarki (ikona kłódki / „aA” obok adresu), a następnie odśwież stronę.";
    case "NotFoundError":
      return "Nie znaleziono kamery lub mikrofonu w tym urządzeniu.";
    case "NotReadableError":
      return "Kamera jest używana przez inną aplikację. Zamknij ją i spróbuj ponownie.";
    case "OverconstrainedError":
      return "Kamera nie obsługuje wymaganych ustawień.";
    default:
      return `Nie udało się uruchomić kamery${name ? ` (${name})` : ""}. Upewnij się, że strona jest otwarta przez HTTPS.`;
  }
}

export function stopStream(s: MediaStream | null) {
  s?.getTracks().forEach((t) => t.stop());
}

export async function requestWakeLock(): Promise<{ release: () => Promise<void> } | null> {
  try {
    const wl = (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    return wl ? await wl.request("screen") : null;
  } catch {
    return null;
  }
}
