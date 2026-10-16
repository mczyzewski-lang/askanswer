/** ElevenLabs text-to-speech models offered for the narrator (Eleven v4 is the default). */
export const DEFAULT_TTS_MODEL = "eleven_v4";

export const TTS_MODELS: Array<{ id: string; label: string }> = [
  { id: "eleven_v4", label: "Eleven v4 — najnaturalniejszy (domyślny)" },
  { id: "eleven_v4_turbo", label: "Eleven v4 Turbo — szybszy, niższy koszt" },
  { id: "eleven_v3", label: "Eleven v3 — ekspresyjny" },
  { id: "eleven_multilingual_v2", label: "Multilingual v2 — stabilny PL" },
  { id: "eleven_flash_v2_5", label: "Flash v2.5 — najszybszy" },
];
