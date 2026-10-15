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

/** Request camera + mic, preferring 1080p portrait at 30 fps with graceful fallbacks. */
export async function openCamera(facing: Facing): Promise<MediaStream> {
  const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
  const attempts: MediaStreamConstraints[] = [
    { video: { facingMode: facing, width: { ideal: 1080 }, height: { ideal: 1920 }, frameRate: { ideal: 30, max: 30 }, aspectRatio: { ideal: 9 / 16 } }, audio },
    { video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio },
    { video: { facingMode: facing }, audio: true },
    { video: true, audio: true },
  ];
  let lastErr: unknown = null;
  for (const c of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(c);
    } catch (e) {
      lastErr = e;
      const name = (e as DOMException).name;
      // permission problems will not be fixed by relaxing constraints
      if (name === "NotAllowedError" || name === "SecurityError" || name === "NotFoundError") break;
    }
  }
  throw lastErr;
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
