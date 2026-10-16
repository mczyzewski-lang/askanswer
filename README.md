# AskBy Studio

**Od pytania do profesjonalnie zmontowanego wideo eksperta w kilka minut.**

AskBy Studio has three modules:

| Module | Path | Purpose |
|---|---|---|
| Questions Manager | `/admin` | Projects, categories, questions, experts, recording links, recordings, review and export |
| Expert Recorder | `/record/[token]` | Mobile-first camera recorder: the question is read aloud by ElevenLabs, the expert answers |
| Video Studio | `/studio/[compositionId]` | Desktop editor with a multitrack timeline, subtitles, pause removal, zooms, branding and MP4 export |

The whole user interface is in Polish.

---

> **Wdrożenie na Railway:** zobacz [DEPLOY_RAILWAY.md](DEPLOY_RAILWAY.md).

## Running locally

Requirements: Node 20+ (tested on 22), PostgreSQL 14+, FFmpeg/ffprobe built with `libx264`, `libvpx`, `libopus` and `libmp3lame`. Docker is optional (it provides Postgres and MinIO).

```bash
cp .env.example .env              # then set APP_SECRET (openssl rand -base64 48)
docker compose up -d              # Postgres + MinIO (optional if you have Postgres locally)
npm install                       # also generates the Prisma client and copies fonts to public/fonts
npx prisma migrate deploy         # create the schema
npm run db:seed                   # admin account, theme presets, demo project
npm run dev                       # Next.js (http://localhost:3000) + background worker
```

* Log in at `http://localhost:3000/login` with `admin@askby.local` / `askby-admin` (set by `ADMIN_EMAIL` / `ADMIN_PASSWORD`).
* The seed prints a demo recording link for the expert "Anna Kowalska". You can also copy it from **Projekt → Eksperci i linki → Kopiuj link**.
* Camera access on a phone requires **HTTPS**. Expose the dev server through a tunnel such as `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`, and set `APP_URL` to the tunnel URL so the generated links point to it.
* For production, run `npm run build && npm start`. This starts both the web server and the worker; in production you can also run `npm run worker` as its own process, and several workers can run side by side safely.

## Environment variables

All variables are listed in `.env.example`.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `APP_URL` | yes | Public URL, used to build recording links |
| `APP_SECRET` | yes (≥32 chars in production) | Signs sessions and media URLs and encrypts invitation tokens |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | seed | Admin account created by `npm run db:seed` |
| `ELEVENLABS_API_KEY` | for narration and subtitles | Server-side only; never sent to the browser |
| `ELEVENLABS_VOICE_ID` | no | Default narrator voice (each project can override it) |
| `ELEVENLABS_TTS_MODEL` | no | Default `eleven_multilingual_v2` (Polish-capable) |
| `ELEVENLABS_STT_MODEL` | no | Default `scribe_v2` |
| `HIGGSFIELD_CREDENTIALS` | for AI B-roll | `KEY_ID:KEY_SECRET`; Studio → AI generates clips with Higgsfield (server-side only) |
| `HIGGSFIELD_MODEL` | no | Default `kling-video/v3.0/pro/text-to-video` (Kling 3.0 Pro, 9:16); also `bytedance/seedance-2.5/text-to-video`, `kling-video/v3.0/std/text-to-video` |
| `HIGGSFIELD_IMAGE_MODEL` | no | Text-to-image model for infographic illustrations, default `flux-pro/kontext/max/text-to-image` |
| `ANTHROPIC_API_KEY` | no | Claude writes the B-roll proposals and prompts from the transcript; without it a basic heuristic is used |
| `CLAUDE_MODEL` | no | Default `claude-opus-5-5` |
| `ELEVENLABS_BASE_URL` | no | Default `https://api.elevenlabs.io` (the tests point it at a mock) |
| `STORAGE_DRIVER` | no | `local` (default) or `s3` |
| `STORAGE_LOCAL_DIR` | no | Private directory used by the local driver (default `./storage`) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | for `s3` | S3 or MinIO settings (MinIO defaults are in `docker-compose.yml`) |
| `FFMPEG_PATH`, `FFPROBE_PATH` | no | Paths to the binaries |
| `MAX_UPLOAD_MB` | no | Maximum size of one recording (default 1024) |
| `INVITATION_TTL_DAYS` | no | Default lifetime of a recording link (default 30) |

## Database setup

* The schema and its migrations are in `prisma/` (PostgreSQL + Prisma 6).
* Run `npx prisma migrate deploy` to apply them, then `npm run db:seed` for the demo data.
* Editing decisions (tracks, clips, effects and layers) are stored as a versioned JSON document on `VideoComposition.document`.
  * It is validated with Zod (`src/lib/editor/schema.ts`) on every save.
  * Saves use optimistic concurrency through the `version` column.
  * I chose this over separate `TimelineTrack`/`TimelineClip`/`TimelineEffect` tables because the editor loads and saves the whole timeline atomically, and the JSON keeps undo, autosave and render input identical.
* These parts are stored in their own tables:
  * the original transcript (`Transcript`, `TranscriptWord`)
  * the generated subtitle grouping (`SubtitleSegment`)
  * the detected pauses (`SilenceSuggestion`)
  * renders (`RenderJob`) and background jobs (`Job`)

## ElevenLabs configuration

1. Create an API key at elevenlabs.io and set `ELEVENLABS_API_KEY` in `.env`. The key needs access to Text to Speech, Speech to Text and Voices.
2. Optionally choose a default Polish-capable voice (`ELEVENLABS_VOICE_ID`).
3. Per project, go to **Ustawienia → Lektor ElevenLabs**. Pick a voice from your account (loaded from `/v1/voices`) and a model (`eleven_multilingual_v2` is recommended for Polish).

How each API is used:

* **TTS** (`POST /v1/text-to-speech/{voice}`):
  * The narration is generated once per (text, voice, model).
  * It is cached as a separate `NARRATION` asset, keyed by a content hash, so repeated playback costs nothing.
  * It is never recorded through the phone microphone.
* **STT** (`POST /v1/speech-to-text`, model `scribe_v2`, `language_code=pol`, `timestamps_granularity=word`):
  * Runs automatically after upload.
  * The word timestamps are stored and drive subtitles, pause detection and zoom suggestions.
  * The same media is never transcribed twice unless an admin clicks "Transkrybuj ponownie".
  * Temporary errors (429/5xx) are retried by a background job, and the recording is always kept.
* **Without a key:** recording, processing, editing and export still work. The UI clearly shows that narration and subtitles need configuration.

## Storage and rendering

**Storage** (`src/lib/server/storage.ts`)

* Media is private.
* With the `local` driver, files are served only through expiring HMAC-signed URLs (`/api/media/...`) that support Range requests.
* With the `s3` driver, the bucket stays private and the browser gets presigned GET URLs. Public buckets are never used.

**Upload and processing pipeline** (`src/lib/server/pipeline.ts`, background worker `src/worker/index.ts`, Postgres queue with `FOR UPDATE SKIP LOCKED`)

1. The upload is chunked and resumable.
2. The file is validated by its magic bytes and by `ffprobe`.
3. The untouched original is stored.
4. It is normalised to an H.264/AAC 30 fps master (rotation applied, keyframe every second).
5. A WebM preview proxy is made for browsers that cannot decode H.264.
6. The real waveform and RMS envelope are computed from decoded PCM.
7. The audio is transcribed with ElevenLabs.
8. Subtitles are grouped, pauses are detected, and the composition is created with status "Gotowe do edycji".

Every step is idempotent and the job statuses are visible in the dashboard.

**Rendering** (`src/lib/render/`)

* There is **no Remotion**, so no commercial licence is needed. Rendering uses FFmpeg + Skia (`@napi-rs/canvas`).
* The browser preview and the exporter call **the same compositor function** (`drawFrame`) with the same OFL font files from `public/fonts`. That shared code is what keeps preview and export the same.
* The server decodes source frames with FFmpeg, draws every output frame with the compositor (zoom, crop, question, subtitles with word highlighting, graphics, theme), encodes H.264, and mixes audio with FFmpeg from the same clip decisions (expert audio, narration, music, fades).
* Frame ranges are rendered in parallel child processes and concatenated. Measured speed is about 30 output fps at 1080×1920 on 4 cores.
* Output: MP4/H.264/AAC at 1080×1920 by default, or 720×1280, 1920×1080 or 1080×1080, with draft, standard or high quality.
* A combined interview is made by rendering the selected videos and concatenating them.

## Features implemented

**Questions Manager**

* Projects and categories, including custom categories.
* Adding questions manually, pasting many at once, and CSV import (columns `pytanie, kategoria, instrukcje, czas`).
* Drag-and-drop ordering, duplicate, edit and delete.
* Statuses Do nagrania / W trakcie / Nagrane / Do poprawy / Zatwierdzone.
* Assigning questions to experts.
* Previewing a question on video, rendered with the real compositor.
* Listening to the narration from the admin side.

**Experts and links**

* Experts and their profiles.
* Recording links are expiring and revocable (32-byte tokens). Only a hash and an AES-GCM ciphertext are stored, so the link can still be copied later.
* Links are scoped to the expert's assigned questions, and the server rejects any other question with 403.
* A link can be copied with "Kopiuj link". Each link records the expert's consent.

**Recorder (mobile)**

* Screens: welcome ("Masz N pytań do nagrania."), consent, camera preparation (live mirrored preview, front/back switch, checklist, face guide, portrait warning), question list grouped by category with statuses, and an optional sequential mode.
* A full-screen recorder with the question shown at the top.
* **Mode A (default):** the camera starts, the microphone is muted while the narration plays, and markers are recorded. Recorder start and `play()` happen in the same tap.
* **Mode B:** the expert listens, sees a 3‑2‑1 countdown, and only the answer is recorded.
* If narration playback fails, it falls back automatically.
* Controls: pause and resume (feature-detected), stop, record again (earlier takes are kept), next question, finish.
* Timer with the recommended length, and a wake lock.
* MIME and codec detection, permission error messages.
* Chunks are saved to IndexedDB while recording, so takes can be recovered after a crash. Uploads are resumable with retry and backoff, keep working offline, and show progress and a "bezpiecznie zapisane" confirmation.
* A completion screen with counts.

**Studio**

* Layout: assets and tools on the left (Pytanie, Nagrania, Napisy, Pauzy, Zbliżenia, Audio, Tekst, Grafika, Szablony, Motyw), a 9:16 canvas in the centre, properties on the right, and a multitrack timeline at the bottom.
* **Timeline:**
  * Tracks for overlays, subtitles, zooms, video, the expert's real waveform, narration and music.
  * Play/pause, scrubbing, Ctrl+wheel and slider zoom.
  * Drag, trim edges, split at the playhead, delete, ripple delete, and range selection on the waveform with "Wytnij fragment".
  * Snapping, timecode as mm:ss:ff, and frame stepping.
* **Undo and saving:** undo/redo (200 steps), autosave (debounced and every 10 s) and protection when leaving the page.
* **Linked video and audio:** expert video and audio are linked clips, so cuts never desync them.
* **Non-destructive editing:** sources are never modified, and "Przywróć pełne nagranie" restores the full recording.
* **Canvas editing:** select, drag, resize with corner and side handles, multi-select (Shift), snapping guides (centre and margins), and dragging subtitles to reposition them.
* **Safe areas:** guides for TikTok, Reels and Shorts that never appear in the export, plus a clean preview mode.
* **Question layer:**
  * an editable text layer with every typography property
  * visibility during narration only, for the first N seconds, or the whole video
* **Subtitles:**
  * transcript-driven editor: edit text, merge, split at a word, delete, move or retime on the timeline
  * five presets with word-by-word highlighting that follows the real timestamps
  * font, size, case, colour, position, animation, and on/off
  * the original transcript is kept separately
* **Wykryj pauzy:**
  * detection from audio energy, with edges refined by word timestamps
  * sensitivity settings and adjustable breathing room (200 ms by default)
  * a list with preview, accept, delete and keep for each pause, plus "Usuń zaznaczoną pauzę" and "Usuń wszystkie zaakceptowane"
  * cuts are reversible with "Przywróć"
* **Dynamiczne zbliżenia:**
  * smooth in and out, jump in and out, and a subtle push-in
  * editable regions (start, end, scales, centre, easing)
  * "Zaproponuj dynamiczne zbliżenia" with Minimal, Standard and Dynamic presets; suggestions are accepted or rejected one by one and only accepted ones are exported
* **Graphics:** text presets, rectangle, ellipse, highlight box, callout, lower third, theme logo, uploaded images, and background music with volume, fades and mute.
* **Narration:** voice change with regeneration (cached), plus mute, volume and move.
* **Replace take:** swaps the take while keeping the design.
* **Themes:** five presets (Pravna, Nowy Etap, Modern Black, Minimal White, Social Bold), exact brand colours and a logo upload. Colours are theme tokens, so a change updates the question, subtitle highlight, lower thirds, callouts and backgrounds in every video of the project, including exports. Fonts are Inter, Manrope, Montserrat, Poppins and DM Sans (SIL OFL).
* **Export:** server render with a progress bar, retry and MP4 download. You can also download the original recording, the subtitles as SRT (timeline-mapped, so they reflect every cut), the edited text as TXT, and the original transcript.
* **Combined interviews** across several questions.

**Security**

* Admin sessions are signed JWT cookies, and the middleware protects `/admin`, `/studio` and `/api/admin`.
* Passwords are hashed with scrypt.
* Uploads are validated by MIME type, magic bytes, size and `ffprobe`.
* Media URLs are signed, and storage is private.
* Expensive operations are rate-limited (TTS, STT, renders, uploads, login).
* Security headers are set.
* Admins can delete recordings and media.

## Not yet implemented

* **Face tracking.** Crop and zoom centres are set by hand or come from the clip framing. The app does not claim to track faces.
* **Multiple admin roles.** There is one admin role (the `EDITOR` role exists in the schema but is not enforced) and no per-admin project ownership.
* **Text box rotation** and keyframed animation of arbitrary properties. Zoom has its own effect model.
* **Audio processing.** There is no noise reduction or loudness normalisation beyond a limiter.
* **Email delivery of invitations.** Links are copied by hand.
* **Shared rate limiting.** It runs in memory; use Redis when running more than one instance.

## Test results

**Unit tests** (`npm test`, Vitest): **15 passed**.

* Timeline operations:
  * split
  * ripple delete keeping video and audio in sync
  * mapping from source time to the timeline after cuts
  * subtitle and SRT remapping
  * applying and restoring pauses
  * trim bounds and move without overlap
  * subtitle edits that leave the source untouched
* Subtitle grouping.
* Zoom interpolation, and confirmation that suggestions are deterministic and not exported.
* Pause detection on synthetic audio, including that cuts never enter a word.
* An integration render with real FFmpeg, checking pixels before and after a 150 % zoom and the `h264`/`aac` streams.

**End-to-end tests** (`npm run test:e2e`, Playwright + Chromium): **4 passed**.

* They use a separate `askby_test` database.
* Camera and microphone come from Chromium's fake media device, fed with generated **test fixtures**: colour bars and tone bursts, clearly labelled and not real recordings.
* ElevenLabs is replaced by a local mock with the same API shapes (`tests/mock/elevenlabs-mock.ts`), because the real API cannot be reached from the sandbox.

| # | Scenario | Result |
|---|---|---|
| 1 | Category + question persist after refresh; bulk paste | ✅ |
| 2 | The invitation shows only the assigned questions; another expert's question gets 403; an invalid token gets 404 | ✅ |
| 3 | Real MediaRecorder recording in the mobile viewport, uploaded and processed | ✅ |
| 4 | Narration played from a separate `NARRATION` asset; markers stored | ✅ (mock API) |
| 5 | Pause/resume: duration covers footage before and after the pause | ✅ |
| 6 | Second take; both kept | ✅ |
| 7 | Transcription with word timestamps → subtitles | ✅ (mock API) |
| 8 | Subtitle edit shows in the preview, the SRT and the exported video | ✅ |
| 9 | The real 2 s silence is detected; one selected pause is removed | ✅ |
| 10 | A waveform range cut shortens the timeline with video and audio linked | ✅ |
| 11 | Smooth 100 %→115 % zoom (preview), with export confirmed in the render unit test | ✅ |
| 12 | Highlight colour change saved to the project theme and used in the export | ✅ |
| 13 | Downloaded MP4: h264 1080×1920 + AAC, duration equal to the edited timeline | ✅ |
| 14 | State restored after reload | ✅ |
| 15 | Mobile compatibility | Partly: see below |

`npx tsc --noEmit` and `next build` both pass.

**What still needs manual hardware testing (Test 15):**

* **Real devices.** The automated tests ran in Chromium with Android emulation (Pixel 7). Recording on a real **iPhone (Safari 17/18)** and **Android Chrome** still has to be checked by hand, especially:
  * the camera orientation
  * whether iOS routes narration to the loudspeaker while recording (if playback fails, Mode A falls back automatically)
  * MP4 MediaRecorder output on Safari
* **The real ElevenLabs API.** It was not reachable from the build sandbox. Make one call of each kind once a key is set: narration, transcription and the voice list.

## Known limitations

* The preview and the export use the same compositor and fonts. Tiny anti-aliasing differences between browser Skia and server Skia are possible.
* Preview playback is driven by the wall clock and re-syncs media elements on drift. Frame-exact playback is only guaranteed in the export. Scrubbing and seeking are frame-accurate.
* Very long recordings make big timeline canvases. The waveform canvas is limited to 8000 px per clip and stretched beyond that.
* Rendering is CPU-bound, about real time on 4 cores at 1080p. Add more workers to scale.

## Project structure

```
prisma/                  schema, migrations, seed (Polish demo data)
src/app/                 Next.js routes: admin, record/[token], studio/[id], api/*
src/components/          admin UI, studio (store, playback engine, timeline, preview, panels)
src/lib/editor/          pure editing model: types, timeline ops, subtitles, silence, zoom, factory, schema
src/lib/render/          shared compositor + server renderer (FFmpeg + Skia)
src/lib/server/          db, auth, storage, ElevenLabs, FFmpeg, jobs, pipeline, render jobs
src/worker/              background worker
tests/unit, tests/e2e    Vitest + Playwright; tests/mock = ElevenLabs mock; scripts/make-fixtures.ts = test media
```
