# HANDOFF — AskBy Studio

Dokument do przeniesienia projektu do nowej rozmowy. Stan na **28.10.2026**, gałąź `claude/pensive-goldberg-4v14gw` (repozytorium GitHub `mczyzewski-lang/askanswer`). Kod w repozytorium jest źródłem prawdy — ten plik opisuje, co gdzie jest i dlaczego.

---

## 1. CEL PROJEKTU

AskBy Studio to polska aplikacja webowa (Next.js) dla kancelarii / marek usług prawno‑finansowych, która zamienia wiedzę eksperta w gotowe krótkie wideo pionowe (Reels / TikTok / Shorts) bez montażysty. Admin przygotowuje treści (pytania klientów albo skrypty Hook + Treść, lub mieszankę), wysyła ekspertowi link; ekspert na telefonie przegląda i akceptuje treści („tinder”), nagrywa się — pytanie czyta lektor ElevenLabs albo ekspert czyta z promptera, który podąża za jego głosem. Serwer sam normalizuje nagranie, robi transkrypcję, napisy, wycina pauzy, rozmywa / podmienia tło, dodaje zbliżenia, ilustracje AI i plansze CTA; admin poprawia w przeglądarkowym Studio (oś czasu, warstwy) i eksportuje MP4 1080×1920. Osobny moduł **Ads Studio** składa dziesiątki reelsów reklamowych z surowych nagrań na podstawie pliku scenariuszy (wersje różniące się tylko hookiem to jeden montaż). Na koniec **scoring treści** (OpenAI, wytyczne redaktora rolek) ocenia skrypty przed nagraniem i proponuje lepszą wersję do podmiany. Efekt końcowy: seria gotowych, spójnych z marką filmów eksperta, nagranych w kilka minut i zmontowanych niemal automatycznie.

---

## 2. STAN OBECNY

### Działa (zaimplementowane, przetestowane automatycznie, wypchnięte)

**Panel admina (`/admin`)**
- Projekty, kategorie i podkategorie, pytania / skrypty: dodawanie ręczne, wklejanie blokami, import CSV (także cp1250 z polskiego Excela), ponowny import CSV aktualizuje istniejące pozycje (upsert po tytule) zamiast duplikować.
- Formaty projektu (`ProjectFormat`): `ANSWERS` (pytanie czyta lektor, ekspert odpowiada swobodnie), `PROMPTER` (Hook + Treść z promptera), `HYBRID` (typ per pozycja: `QUESTION` / `PROMPTER` / `QUESTION_PROMPTER`), `ADS` (kampania Ads Studio, ukryta na liście projektów).
- CSV hybrydy: `typ;kategoria;podkategoria;tytuł wideo;pytanie (lektor);treść` (osobna kolumna na pytanie czytane przez lektora → pole `Question.spokenText`; `text` = tytuł nad wideo).
- Statusy: Do nagrania / W trakcie / Nagrane / Do poprawy / **Do akceptacji** / Zatwierdzone; kolorowe paski, filtr statusów, sortowanie (kolejność, status, najnowsze, liczba ujęć, kategoria, alfabet), drag & drop kolejności.
- Zaznaczanie wielu (shift = zakres) i akcje masowe: status, ekspert, kategoria, typ, usuń (usuwa też pliki nagrań).
- Eksperci w projekcie (ustawienia), linki nagraniowe (wygasające, odwoływalne, token 32 B, w bazie tylko hash + szyfrogram AES‑GCM, „Kopiuj link”), auto‑przypisanie skryptów jedynemu ekspertowi, baner „bez eksperta”.
- Plakietki: „✓ Treść zatwierdzona” (ekspert zaakceptował treść), „Ekspert widzi film”, typ pozycji w hybrydzie.
- **Scoring treści (NOWE, ostatni commit)** — patrz niżej.
- Ustawienia projektu: motyw, lektor (głos ElevenLabs lub losowy z kolekcji, model, naturalne „yyy/mm”), tempo lektora (domyślne przyspieszenie, np. 1,15×), automaty po przetworzeniu (rozmycie tła + siła, głos „podcast + ElevenLabs”, zbliżenia dynamiczne, magiczna poprawa obrazu — domyślnie wył., automatyczne ilustracje), styl napisów, plansza CTA (adres, podpis, sekundy, „dodaj na końcu” albo „nałóż na końcówkę”), dzienny limit pytań u eksperta, podgląd promptów AI do grafik.
- Motywy (`/admin/themes`): 5 presetów, kolory jako tokeny (zmiana motywu przemalowuje wszystkie filmy projektu), logo, style pytania (karta, sam tekst, obrys, linia akcentu, pigułka; góra / środek / dół), styl scen AI per motyw i kategoria.
- Głosy (`/admin/voices`): kolekcje głosów ElevenLabs.
- Panel zadań w tle, ostrzeżenie o zapełnionym dysku, „Ponów wszystkie” dla nieudanych nagrań.

**Nagrywarka eksperta (`/record/[token]`, mobile‑first)**
- Powitanie, zgoda, przygotowanie kamery (podgląd lustrzany, przód/tył, owal twarzy po lewej), lista „Do nagrania” / „Nagrane”, przełącznik „Zatwierdzone” (pokazuje tylko treści zaakceptowane), cichy podpis typu pozycji.
- **Przejrzyj treści**: na telefonie karty — przesunięcie w prawo = akceptacja, w lewo = edycja, „Pomiń” przenosi na koniec kolejki; długie treści przewijają się (swipe działa); na desktopie tabela jak CSV z polami Tytuł wideo / Pytanie (lektor) / Treść i przyciskiem „Zatwierdź”. Zmiana treści przez admina cofa akceptację.
- Tryb A (ciągły, mikrofon wyciszony w czasie lektora, znaczniki) i B (tylko odpowiedź, odliczanie 3‑2‑1).
- Prompter: tekst u góry pod kamerą, przewija się za głosem (ElevenLabs Scribe v2 Realtime przez jednorazowy token — klucz nigdy nie trafia do przeglądarki), nagrywanie startuje dopiero gdy ElevenLabs słucha; tryb tempa jako zapas.
- Pytanie + prompter: lektor czyta pytanie (kamera już nagrywa), potem ekspert czyta odpowiedź.
- Kawałki nagrania w IndexedDB (odzyskiwanie po awarii), upload porcjami z wznawianiem, wake lock, pauza/wznowienie, ponowne ujęcia (stare zostają).
- Nagrania z przedniej kamery zapisywane lustrzanie (jak w podglądzie); znacznik `camera` z rozdzielczością.
- „Twoje filmy” (prawy górny róg): ekspert widzi bieżący montaż filmów w statusie W trakcie / Do akceptacji / Zatwierdzone (render podglądu na żądanie).

**Przetwarzanie (worker)**
- Kolejka zadań w Postgresie (`FOR UPDATE SKIP LOCKED`), dwie „pasy”: media i AI (AI nie czeka za renderami).
- Pipeline: walidacja (magic bytes + ffprobe) → oryginał → normalizacja do H.264/AAC 30 fps (dominujący rozmiar klatki, korekta rozciągnięcia/ściśnięcia, obrót, lustro) → podgląd WebM → waveform/RMS → STT ElevenLabs (słowa z czasami) → napisy, pauzy → kompozycja „Gotowe do edycji” → automaty projektu (rozmycie, głos, zbliżenia, ilustracje AI) → `applyProjectDefaults`.
- Maski osoby: model `models/selfie_segmenter.onnx` (onnxruntime-node, CPU), filtr prowadzony, stabilizacja w czasie, format AMSK (`MASK_VERSION` 4), wykrywanie i usuwanie green screena (chroma key + despill).
- „Napraw obraz” (renormalizacja z oryginału, montaż zostaje), „Transkrybuj ponownie”, „Przetwórz ponownie”.

**Studio (`/studio/[id]`, desktop)**
- Oś czasu wielościeżkowa (grafiki, napisy, zbliżenia, wideo, waveform, lektor, muzyka, plansza CTA jako warstwa), cięcia, ripple delete, wycinanie zakresu na waveformie, snapping, undo/redo (200), autosave z optymistyczną współbieżnością (`version`).
- Podgląd = eksport: ta sama funkcja `drawFrame` (przeglądarka i serwer, @napi-rs/canvas), te same fonty OFL.
- Pytanie (warstwa w stylu motywu), napisy (5 presetów, podświetlanie słowo po słowie, edycja, scalanie/dzielenie, **pozycja Y per fragment**), napisy także dla pytania lektora (STT na pliku narracji), pauzy (wykrywanie + akceptacja), zbliżenia dynamiczne (propozycje Minimal/Standard/Dynamic).
- Grafiki: tekst, kształty, lower third, logo, obrazy, **Blur behind** (kwadrat/koło rozmywające to, co pod nim; wejście domyślnie bez animacji, wyjście wygaszenie; start przyciąga się do grafiki pod spodem), osobna animacja wyjścia dla każdej warstwy, **B‑roll z biblioteki kampanii**.
- AI: ilustracje „myśli eksperta” na cały ekran (OpenAI gpt-image-2, 3 warianty na moment, kontekst sąsiednich zdań, kolory motywu, minimalny polski tekst, bez tekstu w dolnych 30% — tam są napisy), kliknięcie w warstwę grafik dodaje własną ilustrację (kontekst ±8 s), propozycje i generowanie B‑rolli wideo (Higgsfield, Kling 3.0 Pro; prompty pisze Claude, jeśli jest klucz).
- Twarz w kółku (jak Loom) nad grafikami pełnoekranowymi: przeciąganie, rozmiar, domyślnie lewa góra, przybliżenie minimalne (0,6), wysokość twarzy 50; zachowuje rozmyte / AI tło.
- Tło: rozmycie (suwak siły), tło AI (OpenAI, warianty, biblioteka teł projektu do ponownego użycia, suwak rozmycia tła AI), wyłączenie rozmycia per klip.
- Lektor: zmiana głosu i regeneracja (czyta `spokenText`, nie tytuł), tempo lektora (suwak, oś czasu dopasowuje się), wyciszenie, głośność.
- Pytanie jako rozmowa telefoniczna: pasek połączenia u góry (losowe polskie imię, płeć z treści pytania, awatar systemowy albo naturalne „selfie” z OpenAI; rozmiar i pozycja suwakami + przeciąganie na podglądzie; po pytaniu odlatuje w górę) albo pełnoekranowy ekran rozmowy z ekspertem w kółku.
- Plansza CTA: dodana na końcu albo nałożona na końcówkę.
- Zmiana statusu nagrania z nagłówka Studio (przed „Eksportuj”).
- Eksport MP4 (1080×1920 domyślnie; też 720×1280, 1920×1080, 1080×1080; jakość draft/standard/high), SRT/TXT, oryginał, wywiad łączony z wielu pytań.
- Ads Studio: przełącznik wersji hooka w Studio, „Renderuj wszystkie wersje hooka”.

**Ads Studio (`/admin/ads`)**
- Kampanie (tworzenie, usuwanie z plikami). Plik scenariuszy CSV: `reel;hook-number;tytuł;hook;body;cta` (body/CTA mogą być tylko w pierwszym wierszu reelsa); wzór do pobrania.
- Upload surowych nagrań porcjami (duże pliki z kamery), normalizacja, STT ElevenLabs.
- Dopasowanie scenariusza do transkrypcji: Smith‑Waterman z rozmytą równością słów (odmiana, literówki STT, cyfry muszą się zgadzać), łapie słowa dodane przez eksperta w środku i na końcu (płynna mowa bez pauzy), przy dublach wygrywa ostatnie dobre ujęcie; cache podobieństwa słownika (~1,5 s na 53 min nagrań).
- Reelsy różniące się tylko hookiem = **jeden montaż** z wariantami hooka (`doc.hooks`); tytuł z CSV jako tytuł nad reelsem.
- „Wygląd reelsów”: własna kopia motywu kampanii (lub kopia z innego projektu), styl i pozycja tytułu, styl napisów, rozmycie, ekran końcowy CTA.
- Biblioteka B‑roll (wideo do 5 min / 300 MB lub obraz), gwiazdka = wybrane do Studio; w Studio: Grafiki → B‑roll.
- Scoring reelsów (OpenAI) z podmianą treści i eksportem zaktualizowanych scenariuszy CSV.

**Scoring treści (oba miejsca)**
- Moduł `src/lib/server/reel-review.ts` zawiera wytyczne redaktora rolek użytkownika (ROLA, CEL, 8 kryteriów z wagami, CZERWONE FLAGI −10 pkt, zasady formatów [PYTANIE] i [TALKING HEAD KLIENTA], zasady pisania nowej wersji, diagnoza ze statystyk) i wymusza odpowiedź JSON odpowiadającą 8 sekcjom FORMATU WYJŚCIA.
- **Ads Studio**: kolumna „Ocena” (`54/100 → 78` = teraz → przewidywany), średnia, „Oceń nieocenione”, „Oceń wszystkie od nowa”, format rolek + „Grupa docelowa i usługa”, okno oceny (werdykt, tabela kryteriów, flagi, 3 dźwignie, nowa wersja z osią czasu, ujęcia, opis pod rolką, 3 hooki A/B, przewidywany wynik, compliance), „Podmień treść” (hook tego wiersza + body/CTA wszystkich wersji hooka reelsa), „Użyj” przy hooku A/B, „Scenariusze (CSV)”.
- **Zwykłe projekty (NOWE w tym commicie)**: pozycje czytane z promptera (`PROMPTER` i `QUESTION_PROMPTER` z wypełnioną treścią) mają plakietkę oceny na liście; pasek „Scoring treści” nad filtrami statusów: „Oceń nieocenione do nagrania (N)” (tylko status Do nagrania), „Oceń wszystkie od nowa”, pole „Grupa docelowa i usługa” (to samo pole `Project.adsBrief`). Mapowanie: PROMPTER → format [EKSPERT], hook = tytuł, body = treść; QUESTION_PROMPTER → format [PYTANIE], hook = pytanie lektora (`spokenText` lub tytuł). Podmiana: hook → tytuł (PROMPTER) albo → pytanie lektora (QUESTION_PROMPTER: `spokenText`, jeśli ustawione, inaczej tytuł); body + CTA → treść promptera. Podmiana cofa akceptację eksperta (zobaczy nową wersję w „Przejrzyj treści”). Każda zmiana treści (admin, ekspert, re‑import CSV) kasuje starą ocenę. Pytania bez promptera (`QUESTION`) nie są oceniane.

**Testy**: 133 testy jednostkowe (Vitest), 21 testów e2e (Playwright + atrapa ElevenLabs/OpenAI), `tsc` i `next build` przechodzą.

### Działa częściowo / niezweryfikowane na prawdziwych usługach
- **Scoring z prawdziwym OpenAI**: testowany tylko na atrapie. Wywołanie: Chat Completions, `response_format: {type: "json_object"}`, model `OPENAI_TEXT_MODEL` (domyślnie `gpt-5`, przy błędzie 400/404 dotyczącym modelu automatycznie `gpt-4.1`). Przy pierwszym użyciu sprawdzić, czy konto ma dostęp do modelu i czy odpowiedź się parsuje.
- **Statystyki rolki** (wyświetlenia, średni czas, % do końca…) — wytyczne je obsługują (diagnoza), backend przyjmuje `stats`, ale w UI nie ma jeszcze pola do ich wpisania.
- **Ads Studio na prawdziwym materiale**: dopasowanie testowane na transkrypcjach syntetycznych i atrapie STT; jakość na 110 prawdziwych reelsach trzeba ocenić w praktyce (progi `flowGap` 0,45 s, `maxTail` 12 słów, 0,92 najlepszego wyniku dla dubli).
- **Prawdziwe urządzenia**: e2e chodzą w Chromium z emulacją Pixel 7. iPhone Safari 17/18 i Android Chrome (orientacja, lektor przez głośnik podczas nagrywania, MP4 z MediaRecorder w Safari) wymagają ręcznego sprawdzenia.
- **Higgsfield** (B‑roll wideo AI): zaimplementowane z diagnostyką klucza; zależy od konta i modelu.

### Nie działa / nie zrobione
- Śledzenie twarzy (kadrowanie i środek zbliżeń ustawiane ręcznie; jest tylko segmentacja osoby).
- Role adminów (`EDITOR` jest w schemacie, nieegzekwowana), brak właścicieli projektów.
- Wysyłka linków e‑mailem (kopiowanie ręczne).
- Rate limit w pamięci (jedna instancja; przy wielu — Redis).
- ESLint nie ma konfiguracji (`npm run lint` = `tsc --noEmit`).
- Ekspert nie widzi wyniku scoringu w „Przejrzyj treści” (tylko admin).

---

## 3. ARCHITEKTURA I STACK

### Technologie
- **Next.js 15** (App Router, React 19, TypeScript), Tailwind CSS 4, komponenty UI w stylu shadcn napisane w repo (`src/components/ui/index.tsx`, prymitywy Radix).
- **Prisma 6 + PostgreSQL** (27 migracji w `prisma/migrations`).
- **Zustand** — stan Studio (dokument montażu, undo).
- **Worker** w Node (`src/worker/index.ts`, uruchamiany przez `tsx`), kolejka zadań w tabeli `Job`.
- **FFmpeg / ffprobe** (normalizacja, dekodowanie, enkodowanie, audio) + **@napi-rs/canvas** (Skia — rysowanie klatek na serwerze), render równoległy w procesach potomnych (`segment-cli.ts`).
- **onnxruntime-node** + `models/selfie_segmenter.onnx` — maski osoby (rozmycie / podmiana tła).
- **papaparse** (CSV), **zod 4** (walidacja), **jose** (JWT sesji), **fflate**, **idb-keyval** (IndexedDB w nagrywarce), **@dnd-kit** (drag & drop), **lucide-react** (ikony), fonty Google przez `@expo-google-fonts/*` kopiowane do `public/fonts` (SIL OFL).
- Magazyn: lokalny dysk (Railway Volume `/data`) z podpisanymi URL HMAC albo S3/R2/MinIO z presigned URL (`@aws-sdk/client-s3`).
- Testy: **Vitest** (unit), **Playwright** (e2e, osobna baza `askby_test`, atrapa `tests/mock/elevenlabs-mock.ts` udająca ElevenLabs i OpenAI).
- Wdrożenie: **Railway** (`Dockerfile` + `railway.json`; przy starcie: migracje → seed → web + worker).

### Zewnętrzne API (wszystkie klucze tylko po stronie serwera)
| Usługa | Do czego | Gdzie w kodzie |
|---|---|---|
| ElevenLabs TTS | lektor czyta pytanie (cache po tekst+głos+model) | `src/lib/server/elevenlabs.ts`, `narration.ts` |
| ElevenLabs STT `scribe_v2` | transkrypcja nagrań, narracji, materiału Ads | `elevenlabs.ts`, `pipeline.ts`, `ads.ts` |
| ElevenLabs Scribe v2 Realtime | prompter podąża za głosem (jednorazowy token dla przeglądarki) | `api/record/[token]/stt`, `record/[token]/prompter.tsx`, `lib/prompter.ts` |
| ElevenLabs Voice Isolator | „podcast + ElevenLabs” | `enhance.ts` |
| OpenAI Images `gpt-image-2` | ilustracje, tła AI, selfie rozmówcy | `openai-images.ts`, `broll.ts`, `infographic.ts` |
| OpenAI Chat (`gpt-5` → `gpt-4.1`) | scoring treści | `reel-review.ts` |
| Higgsfield | B‑roll wideo AI (Kling 3.0 Pro) | `higgsfield.ts` |
| Anthropic Claude | propozycje B‑rolli i prompty (opcjonalnie, bez klucza heurystyka) | `broll.ts` |

### Model danych (najważniejsze tabele, `prisma/schema.prisma`)
- `User` (admin), `Expert`, `ProjectExpert` (członkostwo), `Theme` (tokeny kolorów, logo, styl pytania, presety tylko do odczytu), `Project` (format, motyw, lektor, automaty, CTA, `blurStrength`, `narrationSpeed`, `subtitlePreset`, `adsBrief`, `adsFormat`…), `Category`/`Subcategory`, `Question` (`text` = tytuł, `spokenText` = co czyta lektor, `script` = treść promptera, `kind`, `contentApprovedAt`, `review`, `reviewedAt`, `status`), `Invitation` (link nagraniowy), `Recording`/`RecordingTake` (ujęcia, znaczniki), `MediaAsset` (wszystkie pliki, `AssetKind`), `Transcript`/`TranscriptWord`, `SubtitleSegment`, `SilenceSuggestion`, `VideoComposition` (`document` JSON = cały montaż, `version`), `RenderJob`, `Job` (kolejka), `VoiceCollection(Item)`, `AdFootage` (surowe nagrania Ads), `AdReel` (reels: `code`, `groupCode`, `title`, `parts`, `matches`, `review`, `compositionId`, `hookIndex`).
- Dokument montażu `EditorDocument` (`src/lib/editor/types.ts`): `clips`, `narration`, `music`, `zooms`, `overlays`, `subtitles`, `pauses`, `endCard?`, `callStyle?`, `hooks?` (Ads), `meta` (`questionText`, tryb, `bgVariants`, `narrationSubs`, `defaults {blur, speed, subs}`…). Walidacja Zod: `src/lib/editor/schema.ts`.

### Drzewko plików (bez `node_modules`, migracji SQL i wygenerowanych fixture’ów)

```
.
├── Dockerfile                 obraz: node 22 + ffmpeg; npm ci, build; start = migracje + seed + web + worker
├── railway.json               builder Dockerfile, healthcheck /login
├── docker-compose.yml         lokalnie Postgres + MinIO
├── DEPLOY_RAILWAY.md          instrukcja wdrożenia krok po kroku (PL)
├── README.md                  opis modułów, zmiennych, pipeline’u, testów (EN)
├── HANDOFF.md                 ten dokument
├── .env.example               wszystkie zmienne z opisami (bez sekretów)
├── models/selfie_segmenter.onnx   model segmentacji osoby (+ README)
├── next.config.ts, tsconfig.json, postcss.config.mjs, vitest.config.ts, playwright.config.ts
├── prisma/
│   ├── schema.prisma          model danych (opis wyżej)
│   ├── migrations/            27 migracji (ostatnie: 20261028100000_ads_review, 20261028120000_question_review)
│   └── seed.ts                admin, presety motywów, projekt demo (idempotentny)
├── scripts/
│   ├── copy-fonts.mjs         kopiuje fonty OFL do public/fonts (postinstall)
│   ├── make-fixtures.ts       generuje testowe media (paski kolorów + tony)
│   └── convert-selfie-segmenter.py   konwersja modelu segmentacji do ONNX
├── src/
│   ├── middleware.ts          sesja wymagana dla /admin, /studio, /api/admin (record jest po tokenie)
│   ├── worker/index.ts        pętla workera: pasy media/AI, switch po typach zadań
│   ├── app/
│   │   ├── layout.tsx, page.tsx, globals.css, icon.svg
│   │   ├── login/             formularz logowania
│   │   ├── admin/             layout (ostrzeżenie o dysku), strony: projekty, projekt, eksperci, motywy, głosy, ads, ads/[id]
│   │   ├── studio/[id]/       strona Studio
│   │   ├── record/[token]/
│   │   │   ├── page.tsx
│   │   │   ├── recorder.tsx   cała nagrywarka (ekrany, kamera, tryby A/B, prompter, upload, „Twoje filmy”)
│   │   │   ├── prompter.tsx   prompter podążający za głosem (Scribe Realtime) / tempo
│   │   │   └── review.tsx     „Przejrzyj treści”: karty swipe (telefon) i tabela (desktop)
│   │   └── api/
│   │       ├── auth/login, auth/logout
│   │       ├── media/[...key]           serwowanie prywatnych plików (podpis HMAC, Range)
│   │       ├── record/[token]/...       sesja eksperta, zgoda, narracja, STT token, upload ujęć porcjami, edycja/akceptacja treści, filmy eksperta
│   │       └── admin/
│   │           ├── projects/[id]/...    projekt, pytania (POST/upsert), bulk, reorder, kategorie, eksperci, linki, combined-render, reprocess-failed, ai-prompts, review (scoring)
│   │           ├── questions/[id]/...   PATCH/DELETE, duplicate, narration, apply-review (podmiana z oceny)
│   │           ├── takes/[id]/...       wybór, pobranie, transkrypt, transkrybuj, przetwórz, napraw obraz, kompozycja
│   │           ├── compositions/[id]/...zapis dokumentu, render, eksport SRT/TXT, narracja (głos, tempo, napisy), tło AI, rozmycie/segmentacja, look, enhance-audio, auto-visuals, B-roll (suggest/generate/infographic/library), call-avatar, replace-take, upload
│   │           ├── ads/...              kampanie, footage (porcje, complete), build, script (import/eksport CSV), theme, broll, review, reels/[id]/apply
│   │           ├── themes, categories, subcategories, experts, invitations, voices, voice-collections
│   │           └── jobs/[id], render-jobs/[id], status, activity, ai/check
│   ├── components/
│   │   ├── ui/index.tsx       Button, Card, Dialog, Input, Select, Switch, Tabs, Toast…
│   │   ├── admin/
│   │   │   ├── dashboard.tsx, project-view.tsx (zakładki projektu + PanelProps), nav.tsx
│   │   │   ├── questions-panel.tsx   lista pytań/skryptów, filtry, sortowanie, bulk, dialogi, CSV, scoring treści (ContentScoringBar)
│   │   │   ├── content-review.tsx    wspólne: typ Review, scoreTone, ScoreBadge, ReviewDialog (Ads i projekty)
│   │   │   ├── ads-studio.tsx        lista kampanii i strona kampanii (materiał, reelsy, wygląd, B-roll, scoring)
│   │   │   ├── settings-panel.tsx    ustawienia projektu; ai-prompts-card.tsx; ai-style-card.tsx; project-experts-card.tsx
│   │   │   ├── invitations-panel.tsx, combined-panel.tsx, experts-view.tsx, themes-view.tsx, theme-preview.tsx, voices-view.tsx, question-preview.tsx, activity-notifier.tsx
│   │   ├── studio/
│   │   │   ├── studio.tsx      układ Studio, nagłówek (status, eksport, wersje hooka)
│   │   │   ├── store.ts        Zustand: dokument, apply z undo, assets
│   │   │   ├── playback.ts     silnik odtwarzania (zegar, synchronizacja mediów)
│   │   │   ├── preview.tsx     kanwa 9:16, edycja na kanwie, strefy bezpieczne, przeciąganie paska rozmowy
│   │   │   ├── timeline.tsx    oś czasu
│   │   │   ├── panels.tsx      panele lewej kolumny (Pytanie, Nagrania, Napisy, Pauzy, Zbliżenia, Audio, Tekst, Grafika, Szablony, Motyw, tło/rozmycie/AI)
│   │   │   ├── properties.tsx  prawa kolumna: właściwości warstwy/klipu, CTA
│   │   │   ├── ai-panel.tsx    ilustracje, B-roll AI, warianty
│   │   │   ├── narration.tsx   lektor: głos, tempo, napisy pytania
│   │   │   ├── call-style.tsx  pytanie jako rozmowa telefoniczna
│   │   │   └── controls.tsx    suwaki, pola, kolor powiązany z tokenem motywu
│   │   ├── voice-picker.tsx, voice-preview.tsx
│   ├── lib/
│   │   ├── editor/            czysty model montażu: types, schema (Zod), timeline (operacje, switchHook, applyEndCard), subtitles, silence, zoom, factory (nowy dokument), ai-overlays, id
│   │   ├── render/
│   │   │   ├── compositor.ts  drawFrame — wspólny rysownik klatek (pytanie, napisy, grafiki, twarz w kółku, blur behind, CTA, rozmowa, osoba z maską)
│   │   │   ├── server-render.ts  render serwerowy (FFmpeg + Skia, równoległe segmenty, audio)
│   │   │   ├── segment-cli.ts    proces potomny renderu zakresu klatek
│   │   │   └── mask-format.ts    format AMSK masek
│   │   ├── server/
│   │   │   ├── env.ts         wszystkie zmienne + diagnostyka kluczy (cleanSecret, openaiKeyDiagnostics)
│   │   │   ├── db.ts, auth.ts, session-token.ts, crypto.ts, http.ts (route wrapper), errors.ts, ratelimit.ts, schemas.ts (Zod wejścia API)
│   │   │   ├── storage.ts, uploads.ts, assets.ts   magazyn plików
│   │   │   ├── jobs.ts        kolejka (enqueue, claimJob z pasami, AI_JOB_TYPES)
│   │   │   ├── pipeline.ts    przetwarzanie ujęcia (normalizacja → STT → kompozycja → automaty)
│   │   │   ├── ffmpeg.ts      wywołania ffmpeg/ffprobe, normalizacja z korektą rozciągnięcia
│   │   │   ├── elevenlabs.ts, narration.ts, enhance.ts
│   │   │   ├── segment.ts     maski osoby (ONNX, guided filter, stabilizacja, green screen)
│   │   │   ├── look.ts        magiczna poprawa obrazu
│   │   │   ├── auto-polish.ts, auto-visuals.ts, project-defaults.ts   automaty po przetworzeniu i domyślne ustawienia projektu (raz na wartość)
│   │   │   ├── broll.ts, infographic.ts, openai-images.ts, higgsfield.ts, broll-library.ts
│   │   │   ├── composition.ts (dane dla Studio), render-job.ts (render, wersje hooka), expert-videos.ts
│   │   │   ├── project-data.ts (dane strony projektu), record-session.ts (dane nagrywarki, tylko przypisane pozycje)
│   │   │   ├── invitations.ts, project-experts.ts, question-delete.ts
│   │   │   ├── ads.ts         Ads Studio: processFootage, matchAll, buildReels, reelDocument, ownTheme, reviewReels, applyReview
│   │   │   ├── reel-review.ts wytyczne redaktora rolek + wywołanie OpenAI + sanityzacja JSON
│   │   │   └── question-review.ts   scoring skryptów z prompterem w projektach (reviewQuestions, applyQuestionReview)
│   │   ├── ads-match.ts       dopasowanie scenariusza do transkrypcji (Smith–Waterman)
│   │   ├── ads-script.ts      parser CSV scenariuszy Ads + wzór
│   │   ├── csv-import.ts      import CSV pytań/skryptów/hybrydy (cp1250/UTF-8) + wzory
│   │   ├── bulk-questions.ts  wklejanie blokami
│   │   ├── question-kinds.ts  typy pozycji, effectiveKind, kindHasNarration/kindHasPrompter
│   │   ├── question-status.ts, project-terms.ts (słownictwo zależne od formatu), question-styles.ts, themes.ts, end-card.ts
│   │   ├── prompter.ts        ScriptFollower (dopasowanie mowy do skryptu)
│   │   ├── fillers.ts, speaker-gender.ts, call-names.ts, tts-models.ts, daily-plan.ts, broll-style.ts, utils.ts
│   │   └── client/            media.ts (wykrywanie możliwości przeglądarki), take-store.ts (IndexedDB), fonts.ts
└── tests/
    ├── unit/                  20 plików Vitest (timeline, napisy, pauzy, zoom, render FFmpeg, blur, hybryda, prompter, ads, normalizacja…)
    ├── e2e/                   Playwright: admin, record, record-prompter, record-review, studio, ads, content-scoring; global-setup (świeża baza testowa), helpers
    └── mock/elevenlabs-mock.ts   atrapa ElevenLabs (TTS, STT „słowoN”, realtime, isolator) i OpenAI (obrazy, chat/completions)
```

---

## 4. KLUCZOWE DECYZJE (i dlaczego)

1. **Brak Remotion** — render na FFmpeg + Skia (@napi-rs/canvas). Powód: brak licencji komercyjnej, pełna kontrola; podgląd i eksport używają **tej samej** funkcji `drawFrame` i tych samych fontów, więc wyglądają identycznie. Nie wprowadzać drugiej ścieżki rysowania.
2. **Montaż jako jeden dokument JSON** (`VideoComposition.document`, walidacja Zod, `version` do optymistycznej współbieżności) zamiast tabel ścieżek/klipów — edytor ładuje i zapisuje całość atomowo, undo/autosave/render mają to samo wejście.
3. **Edycja nieniszcząca** — oryginał nigdy nie jest modyfikowany; cięcia to decyzje w dokumencie; „Przywróć pełne nagranie” i „Napraw obraz” działają z oryginału.
4. **Klucze API tylko w Railway Variables, tylko serwer.** Przeglądarka dostaje jednorazowe tokeny (Scribe Realtime). Użytkownik nigdy nie wkleja kluczy do czatu. `cleanSecret` toleruje wklejone `NAZWA=`, cudzysłowy, „Bearer”, spacje; diagnostyka pokazuje tylko nazwy zmiennych i długość klucza.
5. **Kolejka w Postgresie** (bez Redis/BullMQ) z `SKIP LOCKED`; osobny pas AI, żeby ilustracje powstawały od razu po nagraniu, a nie po renderach. Worker łapie błędy `completeJob/failJob` (np. gdy wiersz zadania zniknął) zamiast się wywracać.
6. **Automaty projektu stosowane raz na wartość** (`meta.defaults`) — późniejsze zmiany w Studio wygrywają; zmiana ustawienia projektu stosuje się do filmów, które jeszcze jej nie miały.
7. **Kolory jako tokeny motywu** — zmiana motywu przemalowuje wszystkie filmy (także eksporty). Presety motywów są tylko do odczytu → kampanie Ads dostają **własną kopię** motywu (`ownTheme`), żeby zmiana nie psuła innych projektów.
8. **Ilustracje AI zamiast slajdów tekstowych** — „ilustracje myśli eksperta” na cały ekran z twarzą w kółku; 3 warianty na moment (różne metafory), kontekst sąsiednich zdań, kolory motywu, minimalny polski tekst, **żadnego tekstu w dolnych 30%** (napisy). Jakość obrazów domyślnie `medium`, 1536 px — bo `high` zjadało kredyty (~4× drożej).
9. **OpenAI jako domyślny silnik obrazów** (gpt-image-2); Higgsfield tylko do wideo B‑roll; Claude opcjonalnie do promptów B‑roll.
10. **Segmentacja osoby lokalnie** (ONNX selfie segmenter na CPU) zamiast usług zewnętrznych — koszt zero, prywatność; maski stabilizowane w czasie i zsynchronizowane z wyświetlaną klatką (wcześniej rozmycie „skakało”).
11. **Normalizacja wg dominującego rozmiaru klatki + znacznik kamery** — telefony zmieniają rozdzielczość w trakcie (pierwsza sekunda pozioma) i zapisują obraz ściśnięty; wcześniejsze podejście (rozmiar pierwszej klatki) rozciągało obraz.
12. **Przednia kamera zapisywana lustrzanie** (jak w podglądzie) — prośba użytkownika; owal twarzy zawsze po lewej.
13. **Hybryda: `text` = tytuł nad wideo, `spokenText` = pytanie lektora, `script` = treść promptera** — tytuł i pytanie lektora to dwie różne rzeczy (użytkownik to poprawiał), osobne kolumny w CSV i osobne pola w przeglądzie treści.
14. **Zmiana treści cofa akceptację eksperta i kasuje ocenę scoringu** — żeby nie nagrać/nie oceniać nieaktualnej wersji.
15. **Ads Studio: Smith‑Waterman na słowach** zamiast prostego wyszukiwania fraz — ekspert dodaje słowa, myli się, powtarza dubel; wygrywa ostatnie dobre ujęcie; ogon cięcia trwa, dopóki mowa płynie bez pauzy, ale zatrzymuje się na początku innej części scenariusza.
16. **Reelsy różniące się hookiem = jeden montaż** (`doc.hooks`, przełącznik w Studio, render wszystkich wersji jednym żądaniem `allHooks` — limit 10 renderów blokował 110 wersji).
17. **Format CSV Ads ustalony przez użytkownika**: `reel;hook-number;tytuł;hook;body;cta` (body/CTA wystarczą w pierwszym wierszu reelsa). Bez kolumny hook-number reelsy z identycznym body+CTA i tak są łączone.
18. **Scoring: jeden moduł wytycznych dla Ads i projektów** (`reel-review.ts`), odpowiedź w JSON (zamiast wolnego tekstu) — żeby dało się pokazać sekcje i automatycznie podmienić treść. Pole kontekstu „Grupa docelowa i usługa” to wspólne `Project.adsBrief`. Ocena w tle (zadanie `ads-review` / `question-review`), jedno zapytanie na pozycję, przerwanie serii przy braku klucza/kredytów. Domyślny model `gpt-5`, awaryjnie `gpt-4.1`.
19. **Scoring w projektach tylko dla treści z prompterem** — pytania swobodne (lektor + odpowiedź bez skryptu) nie mają scenariusza do oceny. Hurtowe „Oceń” obejmuje tylko status Do nagrania (scoring jest „przed nagrywaniem”).
20. **Odrzucone / ślepe uliczki:**
    - `string_contains` na kolumnie JSON (sprawdzanie użycia B‑rollu) — nie działa dla zagnieżdżeń; zastąpione SQL `document::text LIKE`.
    - Selektor Zustand zwracający nowe `[]` — nieskończona pętla renderów; używać stałych (`NO_VARIANTS`).
    - Lustrzany owal twarzy zależny od kamery — użytkownik chciał zawsze po lewej.
    - Generowanie tego samego obrazu dla wszystkich momentów — zastąpione różnymi metaforami + wariantami.
    - Czekanie z ilustracjami do otwarcia Studio — teraz od razu po nagraniu (pas AI).
    - Logowanie Claude’a na produkcję użytkownika — odmówione i nie robić (brak danych logowania, bezpieczeństwo).
    - Pole formatu w ustawieniach kampanii ADS — ukryte (resetowało format).

---

## 5. KONFIGURACJA

### Zmienne środowiskowe (wartości sekretne tylko w Railway → usługa → Variables)
| Zmienna | Wymagana | Opis / domyślnie |
|---|---|---|
| `DATABASE_URL` | tak | Postgres (`${{Postgres.DATABASE_URL}}` na Railway) |
| `APP_URL` | tak | publiczny adres (linki nagraniowe), np. `https://${{RAILWAY_PUBLIC_DOMAIN}}` |
| `APP_SECRET` | tak | ≥32 znaki; **nie zmieniać** po starcie (przestaną działać linki) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | seed | konto admina tworzone przy pierwszym starcie (hasło ≥10 znaków) |
| `ELEVENLABS_API_KEY` | lektor, napisy, prompter | klucz z dostępem do TTS, STT, Voices |
| `ELEVENLABS_VOICE_ID` | nie | domyślny głos (`pNInz6obpgDQGcFmaJgB`) |
| `ELEVENLABS_TTS_MODEL` | nie | `eleven_v4` |
| `ELEVENLABS_STT_MODEL` | nie | `scribe_v2` |
| `ELEVENLABS_REALTIME_STT_MODEL` | nie | `scribe_v2_realtime` |
| `ELEVENLABS_BASE_URL` | nie | testy wskazują atrapę |
| `OPENAI_API_KEY` | ilustracje, tła AI, selfie, scoring | `sk-…`; akceptowane też podobne nazwy zmiennych |
| `OPENAI_BASE_URL` | nie | `https://api.openai.com/v1` (testy: atrapa) |
| `OPENAI_IMAGE_MODEL` | nie | `gpt-image-2` |
| `OPENAI_IMAGE_QUALITY` | nie | `medium` (`low`/`high`) |
| `OPENAI_IMAGE_LONG` | nie | `1536` |
| `ILLUSTRATION_VARIANTS` | nie | `3` (1–4) |
| `OPENAI_TEXT_MODEL` | nie | `gpt-5` (scoring; awaryjnie `gpt-4.1`) |
| `HIGGSFIELD_CREDENTIALS` | B‑roll wideo AI | `KEY_ID:KEY_SECRET` (akceptowane też `HIGGSFIELD_API_KEY`+`_SECRET`, `HF_*`) |
| `HIGGSFIELD_MODEL` | nie | `kling-video/v3.0/pro/text-to-video` |
| `HIGGSFIELD_IMAGE_MODEL` | nie | `flux-pro/kontext/max/text-to-image` |
| `ANTHROPIC_API_KEY` | nie | propozycje B‑rolli (bez klucza heurystyka); `CLAUDE_MODEL` domyślnie `claude-opus-5-5` |
| `STORAGE_DRIVER` | nie | `local` (domyślnie) / `s3` |
| `STORAGE_LOCAL_DIR` | nie | `./storage`; na Railway `/data` (Volume!) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | dla s3 | np. Cloudflare R2 |
| `FFMPEG_PATH`, `FFPROBE_PATH` | nie | ścieżki binariów |
| `MAX_UPLOAD_MB` | nie | 1024 (nagranie eksperta) |
| `ADS_MAX_UPLOAD_MB` | nie | limit pliku materiału Ads |
| `INVITATION_TTL_DAYS` | nie | 30 |
| `RENDER_CONCURRENCY`, `FFMPEG_THREADS`, `SEGMENT_THREADS` | nie | równoległość renderu / segmentacji (Railway: `RENDER_CONCURRENCY=2`) |

### Wymagania
Node 20+ (testowane 22), PostgreSQL 14+, FFmpeg z `libx264`, `libvpx`, `libopus`, `libmp3lame`. Docker opcjonalnie (Postgres + MinIO).

### Uruchomienie lokalne krok po kroku
```bash
git clone https://github.com/mczyzewski-lang/askanswer.git && cd askanswer
git checkout claude/pensive-goldberg-4v14gw
cp .env.example .env                 # ustaw APP_SECRET (openssl rand -base64 48) i klucze, które masz
docker compose up -d                 # Postgres + MinIO (albo własny Postgres)
npm install                          # generuje klienta Prisma, kopiuje fonty
npx prisma migrate deploy            # schemat bazy
npm run db:seed                      # admin + presety motywów + projekt demo
npm run dev                          # Next.js http://localhost:3000 + worker
```
Logowanie: `http://localhost:3000/login`, `admin@askby.local` / `askby-admin` (lub z `ADMIN_*`). Kamera na telefonie wymaga HTTPS — tunel (`cloudflared tunnel --url http://localhost:3000`) i `APP_URL` = adres tunelu.

### Testy
```bash
npx tsc --noEmit                     # typy (to jest też "npm run lint")
npx vitest run                       # 133 testy jednostkowe
npx playwright test                  # 21 testów e2e (baza askby_test, port 3100, atrapa na osobnym porcie)
npx next build
```
W kontenerze deweloperskim: przed e2e `service postgresql start` i zabicie starych procesów:
`ps aux | grep -E "next dev|worker/index|elevenlabs-mock" | grep -v grep | awk '{print $2}' | xargs -r kill -9`.
`global-setup` czyści bazę testową; testy nigdy nie dotykają bazy deweloperskiej.

### Wdrożenie (Railway) — szczegóły w `DEPLOY_RAILWAY.md`
1. Postgres jako usługa. 2. Usługa z repozytorium, gałąź `claude/pensive-goldberg-4v14gw`, Generate Domain (port 3000). 3. **Volume `/data`** (bez niego nagrania znikają przy każdym deployu; Trial 0,5 GB, Hobby 5 GB, Pro 50 GB — przy wielu nagraniach R2/S3). 4. Variables (tabela wyżej). 5. Deploy — przy starcie migracje + seed + web + worker. Po pushu trzeba poczekać na build Railway i odświeżyć stronę z pominięciem cache (Ctrl+Shift+R) — „nie widzę zmiany” zwykle oznacza niezakończony deploy lub cache.

### Druga kopia produktu (inna domena)
Ustalone wcześniej: można skopiować repozytorium do nowego (fork / nowe repo z tej gałęzi), utworzyć osobny projekt Railway z własną bazą, Volume i zmiennymi (nowy `APP_SECRET`), podpiąć własną domenę w Settings → Networking → Custom Domain i ustawić `APP_URL`. Dwa produkty rozwijają się wtedy niezależnie.

---

## 6. OTWARTE PROBLEMY / RZECZY NIEDOKOŃCZONE

1. **Scoring z prawdziwym OpenAI niesprawdzony** (tylko atrapa) — zweryfikować dostęp do `gpt-5`, parsowanie JSON, czas i koszt (jedno zapytanie na pozycję; dla 110 reelsów = 110 zapytań). W razie problemów ustawić `OPENAI_TEXT_MODEL=gpt-4.1`.
2. **Brak pola na statystyki rolki** w UI scoringu (backend `ReviewInput.stats` już jest).
3. Po „Podmień treść” plakietka nadal pokazuje **starą** ocenę do czasu „Oceń ponownie” (w projektach — dopóki treść nie zostanie zmieniona ręcznie; edycja kasuje ocenę). Do rozważenia: automatyczna ponowna ocena po podmianie.
4. Ekspert nie widzi oceny ani propozycji w „Przejrzyj treści”.
5. Ads Studio — jakość dopasowania na realnym materiale do sprawdzenia; brak ręcznej korekty granic cięcia w widoku kampanii (korekta tylko w Studio).
6. Ręczne testy na iPhonie / Androidzie (patrz sekcja 2).
7. Rate limit w pamięci; rola `EDITOR` nieegzekwowana; brak e‑maili z linkami; brak śledzenia twarzy.
8. ESLint bez konfiguracji (`next lint` pyta interaktywnie) — lintem jest `tsc`.
9. Środowisko testowe: Postgres w kontenerze potrafi się zatrzymać po restarcie, a stare procesy `next dev`/worker/atrapa blokują porty → komenda z sekcji 5.
10. Ostrzeżenia `MaxListenersExceededWarning` w logu serwera testowego — kosmetyczne.
11. Dysk Railway: przy zapełnieniu przetwarzanie kończy się komunikatem „Brak miejsca na dysku serwera”; materiał Ads (długie pliki z kamery) zajmuje dużo — rozważyć R2 przed większą kampanią.

---

## 7. NASTĘPNE KROKI (priorytet)

1. **Wdrożyć i sprawdzić scoring na produkcji** (po deployu): Ads Studio → kampania → „Oceń nieocenione”; projekt z prompterem → „Oceń nieocenione do nagrania”. Jeśli błąd modelu — `OPENAI_TEXT_MODEL=gpt-4.1`.
2. Pole „Statystyki” przy ocenie (per reels / pozycja) → diagnoza utraty widzów zgodnie z wytycznymi.
3. Automatyczna ponowna ocena po podmianie (albo oznaczenie „ocena nieaktualna”).
4. (Opcjonalnie) pokazanie oceny / propozycji ekspertowi w „Przejrzyj treści” lub możliwość, by ekspert przyjął propozycję.
5. Weryfikacja Ads Studio na prawdziwej kampanii (110 reelsów): jakość dopasowania, czas przetwarzania, miejsce na dysku; ewentualnie ręczna korekta granic w widoku kampanii.
6. Testy na prawdziwych telefonach (iOS Safari, Android Chrome).
7. Porządki techniczne: konfiguracja ESLint, rate limit w Redis przy wielu instancjach, role adminów.

---

## 8. PREFERENCJE UŻYTKOWNIKA

- **Język**: odpowiedzi po polsku; interfejs aplikacji w całości po polsku; komentarze w kodzie i komunikaty commitów po angielsku (styl repo).
- **Tryb pracy**: krótkie polecenia (często ze zrzutem ekranu), oczekuje, że Claude sam zaimplementuje całość end‑to‑end: kod → testy (unit + e2e) → `tsc` → `next build` → commit → push na `claude/pensive-goldberg-4v14gw`, bez dopytywania o oczywiste rzeczy. Na koniec krótkie podsumowanie po polsku: co zrobione, gdzie w UI to znaleźć, co ustawić w Railway.
- **Gałąź**: zawsze `claude/pensive-goldberg-4v14gw`; **bez Pull Requestów**, chyba że wyraźnie poprosi.
- **Commity** kończą się stopką:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018geEW5QPGgjgtcQxwdKjwD
  ```
  (W nowej sesji użyć stopki, którą poda środowisko; nie wpisywać identyfikatorów modeli w treść commitów ani kodu.)
- **Bezpieczeństwo**: klucze API nigdy w czacie ani w kodzie — tylko Railway Variables; nie logować się na produkcję użytkownika.
- **Koszty**: wrażliwy na zużycie kredytów OpenAI (stąd jakość `medium`, warianty konfigurowalne, potwierdzenia przy masowych operacjach z liczbą zapytań).
- **UX**: domyślne ustawienia mają działać od razu (np. rozmycie tła domyślnie, tempo lektora w projekcie), ale z możliwością zmiany w ustawieniach projektu i per film w Studio; wszystko, co widoczne w filmie, powinno być warstwą na osi czasu i dać się przesunąć / zmienić rozmiar; podgląd = eksport.
- **Treści**: tytuł nad wideo ≠ pytanie lektora ≠ treść promptera (trzy osobne pola); styl subtelny („napisz delikatnie”); mobile dla eksperta (swipe), desktop dla admina (tabele).
- **Gdy „nie widać zmiany”**: najpierw sprawdzić, czy kod jest wypchnięty; jeśli tak — wyjaśnić, że to deploy Railway / cache przeglądarki.
- Lubi konkretne wytyczne i formaty (np. CSV) podane przez Claude’a, a potem je koryguje — formaty ustalone przez niego są wiążące.

---

## 9. PROMPT STARTOWY DO NOWEJ ROZMOWY

```
Pracujemy nad projektem AskBy Studio — repozytorium GitHub mczyzewski-lang/askanswer,
gałąź claude/pensive-goldberg-4v14gw (na niej rozwijaj, commituj i pushuj; bez Pull Requestów,
chyba że poproszę). Odpowiadaj po polsku.

Zanim cokolwiek zmienisz:
1. Przeczytaj w repozytorium pełny HANDOFF.md (cel, stan, architektura, decyzje, konfiguracja,
   otwarte problemy, następne kroki, moje preferencje), a potem README.md i DEPLOY_RAILWAY.md.
2. Przejrzyj `git log --oneline | head -30`, żeby zobaczyć ostatnie zmiany
   (ostatnie: scoring treści OpenAI w Ads Studio i w projektach z prompterem).
3. Trzymaj się ustaleń z HANDOFF.md, sekcja 4 (Kluczowe decyzje), i nie wracaj do odrzuconych rozwiązań.

Zasady:
- Klucze API są tylko w Railway Variables (po stronie serwera). Nigdy nie proś mnie o wklejenie klucza do czatu.
- Nie loguj się na moją produkcję.
- Każdą zmianę doprowadzaj do końca: kod → testy (vitest + e2e Playwright z atrapą) → npx tsc --noEmit →
  next build → commit (komunikat po angielsku, ze stopką atrybucji podaną przez środowisko) → push.
  Na koniec krótko po polsku: co zrobione, gdzie to jest w interfejsie, co ewentualnie ustawić w Railway.
- Przed e2e w kontenerze: `service postgresql start` i zabij stare procesy `next dev`/worker/atrapy.
- Interfejs aplikacji w całości po polsku; podgląd w Studio musi wyglądać tak samo jak eksport (wspólny drawFrame).
- Jeśli mówię, że czegoś nie widzę na produkcji, najpierw sprawdź, czy zmiana jest wypchnięta;
  jeśli jest, to prawdopodobnie deploy Railway albo cache przeglądarki.

Pierwsze zadanie: [tu wpisz, co chcesz zrobić — np. „dodaj pole Statystyki do scoringu treści” albo
„sprawdź scoring na produkcji: dostałem błąd …”].
```
