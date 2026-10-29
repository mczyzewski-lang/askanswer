# Social Media Studio

Moduł AskBy Studio do przygotowania, akceptacji, planowania, publikacji i analizy treści social media dla wielu klientów. Adres w aplikacji: **`/social`** (z panelu AskBy Studio: przycisk „Social Media” w menu).

Najważniejsza ścieżka: **wybieram projekt → dodaję film → AI tworzy osobne wersje na każdą platformę → poprawiam opisy → wybieram daty → zatwierdzam → system publikuje → widzę wyniki i komentarze → AI proponuje odpowiedzi.**

Platformy: Instagram (Reels), Facebook (Reels i posty wideo), TikTok, YouTube (Shorts), LinkedIn (filmy na profilu lub stronie firmy).

> **Status integracji z Upload-Post:** kod adaptera jest kompletny i przetestowany automatycznie na atrapie API (`tests/mock/upload-post-mock.ts`), która odtwarza kształty żądań i odpowiedzi z oficjalnej biblioteki `upload-post` (npm, wersja 2.16). **Nie był sprawdzony na żywym API Upload-Post**: w środowisku developerskim dokumentacja `docs.upload-post.com` i API były niedostępne, a testy nie mogą publikować na prawdziwych kontach. Przed pierwszą prawdziwą publikacją zrób test na koncie testowym (patrz „Pierwsze uruchomienie na żywo”).

---

## 1. Jak to jest zbudowane

### Hierarchia i izolacja danych
`Organization → SocialProject → SocialAccount`. Każdy rekord (media, publikacje, komentarze, wyniki) należy do projektu. Każdy endpoint `/api/social/*` sprawdza rolę osoby w projekcie (`src/lib/server/social/access.ts`). Projekt bez dostępu zwraca **404**, więc jego istnienie nie wycieka. Listy (kalendarz, akceptacje, komentarze) są zawsze filtrowane do projektów z dostępem.

### Role (`src/lib/social/rbac.ts`)
| Rola | Może |
|---|---|
| Właściciel (Owner) | wszystko, także usunięcie projektu i jego danych |
| Administrator | konta, ustawienia marki, zespół, treści, akceptacje |
| Redaktor (Editor) | media, treści, wysyłka do akceptacji, harmonogram, anulowanie, odpowiedzi na komentarze |
| Akceptujący (Approver) | przegląd i akceptacja publikacji (np. klient) |
| Podgląd (Viewer) | tylko odczyt |

Rola może być przypisana do całej organizacji albo do jednego projektu. Uprawnienia się sumują. Pracownicy studia (konta `ADMIN`/`EDITOR` AskBy) mają rolę właściciela wszędzie. Klienci zaproszeni linkiem dostają konto typu `MEMBER`: widzą tylko Social Media Studio i swoje projekty (narzędzia wideo `/admin` i `/studio` są dla nich zamknięte).

### Warstwy
- **UI** — `src/app/social/*`, `src/components/social/*` (dashboard, projekty, biblioteka, edytor, akceptacje, kalendarz, publikacje, komentarze, analityka, ustawienia); tryb jasny / ciemny / systemowy.
- **API** — `src/app/api/social/*`, webhook `src/app/api/hooks/upload-post`, zaproszenia `src/app/api/invite/[token]`.
- **Usługi** (`src/lib/server/social/`):
  - `access` — RBAC i izolacja;
  - `accounts` — profile dostawcy, łączenie i synchronizacja kont;
  - `media` — upload, FFprobe, konwersja, transkrypcja, import z URL (ochrona przed SSRF);
  - `ai` — generator, regeneracje, komentarze, analityk;
  - `posts` — workflow i akceptacje;
  - `publisher` — zlecenia u dostawcy, anulowanie, rekonsyliacja;
  - `webhooks`, `analytics`, `comments`, `notify` (powiadomienia), `audit`, `tick` (cykliczne zadania), `demo`.
- **Adapter dostawcy** (`src/lib/server/social/provider/`):
  - `UploadPostProvider` — prawdziwe API;
  - `DemoProvider` — tryb DEMO, stan w bazie;
  - wspólny interfejs `SocialProvider`.
- **Zadania w tle** — ta sama kolejka Postgres co reszta aplikacji (`Job`, `FOR UPDATE SKIP LOCKED`). Worker ma osobną „pasę” `social` dla wywołań API dostawcy, żeby publikacje nie czekały za renderami wideo. Raz na minutę powstaje zadanie `social-tick` (klucz idempotencji na minutę, więc działa dobrze przy wielu workerach). Tick sprawdza zaległe zlecenia, metryki i komentarze.
- **Reguły platform** — osobny, wersjonowany moduł `src/lib/social/rules.ts` (`RULES_VERSION`). Zawiera limity znaków i hashtagów, wymagania wideo i wytyczne pisania dla AI. Każda generacja AI zapisuje wersję reguł, według której powstała.

### Model danych (Prisma, migracja `20261029080032_social_media_studio`)
- **Organizacje i zespół:** `Organization`, `OrganizationMember`, `SocialProject`, `SocialProjectMember`, `BrandSettings`, `KnowledgeDoc`, `UserInvite`.
- **Konta:** `ProviderProfile`, `SocialAccount`.
- **Media:** `SocialMedia`, `SocialMediaVariant`.
- **Treści i workflow:** `ContentItem` (film), `PlatformPost` (jedna publikacja na jedno konto, z własnym statusem), `ContentRevision`, `Approval`, `ScheduledPublication` (zlecenie u dostawcy), `PublicationAttempt` (każde żądanie do dostawcy).
- **Wyniki i komentarze:** `AnalyticsSnapshot`, `SocialComment`, `CommentReply`, `AiGeneration`.
- **System:** `Notification`, `WebhookEvent`, `AuditLog`, `DemoProviderRecord`.

Daty są zapisywane w UTC, a wyświetlane w strefie projektu (domyślnie `Europe/Warsaw`, `src/lib/social/tz.ts`). Status każdej platformy żyje w osobnym wierszu `PlatformPost`, a nie we wspólnym polu JSON.

### Workflow publikacji
```
DRAFT → PENDING_APPROVAL → APPROVED → SCHEDULING → SCHEDULED → PUBLISHING → PUBLISHED
                       ↘ CHANGES_REQUESTED / REJECTED      ↘ SCHEDULING_FAILED / PUBLISH_FAILED
                                                CANCELLED · REAUTH_REQUIRED
```
- **Akceptacja dotyczy konkretnej wersji.** Hash treści obejmuje: tytuł, opis, hashtagi, CTA, pierwszy komentarz, okładkę, opcje platformy, plik (oryginał albo wersję pochodną), konto docelowe razem z jego identyfikatorem na platformie, stronę FB/LinkedIn i termin. Akceptujący zatwierdza numer wersji, którą widział. Jeśli w międzyczasie ktoś coś zmienił, akceptacja zostaje odrzucona.
- **Zapisywane są:** kto zatwierdził, kiedy, którą wersję i z jakim komentarzem.
- **Zmiana po akceptacji** (treść, plik, konto, strona, data) unieważnia akceptację i przywraca status „Do akceptacji”. Zlecenie u dostawcy zostaje wstrzymane (anulowane), a po ponownej akceptacji powstaje nowe.
- **Wyjątek:** akceptujący, który przesuwa termin w kalendarzu, może od razu zatwierdzić nową datę. Wtedy zlecenie jest edytowane w miejscu (`PATCH /api/uploadposts/schedule/{job_id}`).
- **Do dostawcy trafia tylko aktualna, zatwierdzona wersja** (`assertApproved`, sprawdzane jeszcze raz tuż przed wysłaniem). Przed wysyłką aplikacja odczytuje też konto u dostawcy, żeby wykryć zmianę identyfikatora lub utratę autoryzacji.

### Niezawodność publikacji
- **Jedno zlecenie na każde konto docelowe** (`POST /api/upload` z `scheduled_date`). Każde zlecenie ma:
  - stabilny `externalId` (`smp_<post>_<generacja>`) do korelacji;
  - `Idempotency-Key`, który dostawca zwija w jedno zlecenie przy powtórzeniu w ciągu 24 h — tak opisuje to oficjalny SDK.
- **Timeout po wysłaniu** oznacza zlecenie jako „niepewne” (`UNKNOWN`). Rekonsyliacja wysyła je ponownie **z tym samym kluczem**: jeśli pierwsze dotarło, dostawca zwraca to samo zlecenie. Nowy klucz (nowa generacja) powstaje tylko po potwierdzonym anulowaniu.
- **Rekonsyliacja** (co minutę) sprawdza:
  - zlecenia niepewne;
  - zlecenia po terminie;
  - zlecenia w trakcie publikacji;
  - zatwierdzone posty bez zlecenia, np. gdy worker nie działał.

  Jest potrzebna, bo webhook może nie dotrzeć.
- **Błędy dostawcy:**
  - błędy 429 i 5xx są ponawiane z backoffem, z respektowaniem `Retry-After`;
  - błędy 4xx kończą się statusem `SCHEDULING_FAILED` z treścią błędu;
  - 401/403 z komunikatem o tokenie oznacza `REAUTH_REQUIRED`.
- Każde żądanie do dostawcy jest zapisane w `PublicationAttempt` (edytor → Historia → Zlecenia u dostawcy).

---

## 2. Konfiguracja Upload-Post

1. Załóż konto na upload-post.com i wygeneruj **API key** (panel → API Keys).
2. W Railway → usługa aplikacji → **Variables** dodaj `UPLOAD_POST_API_KEY` (wartość tylko tam: klucz nigdy nie trafia do przeglądarki ani do repozytorium). Opcjonalnie `UPLOAD_POST_BASE_URL` (domyślnie `https://api.upload-post.com/api`).
3. Po wdrożeniu nowe projekty są projektami „na żywo” (bez znaczka DEMO). Projekty DEMO zostają DEMO na zawsze i zawsze trafiają do atrapy, więc nie da się nimi przypadkiem opublikować prawdziwego posta.
4. **Profile klientów:**
   - każdy projekt dostaje u dostawcy stały profil `project_<id projektu>` (`POST /api/uploadposts/users`);
   - jeden profil to najwyżej jedno konto danej platformy — drugie konto, np. drugi Instagram w tym samym projekcie, trafia do kolejnego profilu `project_<id>_2`. Robi to automatycznie przycisk „Połącz konto”.
5. **Łączenie kont (white-label OAuth):**
   - „Połącz konto” wywołuje `POST /api/uploadposts/users/generate-jwt` (`redirect_url`, `platforms`, `language: pl`);
   - klient loguje się na stronie dostawcy i wraca do `/social/projects/<id>/accounts/callback`, gdzie aplikacja synchronizuje konta (`GET /api/uploadposts/users`);
   - hasła nie przechodzą przez aplikację.
6. **Facebook:** po połączeniu wybierz stronę firmową („Strona Facebook”, `GET /api/uploadposts/facebook/pages`). Bez niej publikacji na Facebooku nie da się zatwierdzić.
7. **LinkedIn:** można wybrać profil osobisty albo stronę firmy (`GET /api/uploadposts/linkedin/pages`).
8. **TikTok:** komentarze wymagają uprawnienia `comments` nadawanego przy łączeniu. Konto połączone wcześniej trzeba połączyć ponownie — aplikacja pokaże wtedy „Połącz ponownie” zamiast udawać dane.

### Pierwsze uruchomienie na żywo (zalecane)
1. Utwórz projekt testowy i połącz w nim jedno konto testowe (np. prywatny TikTok albo YouTube z widocznością „Niepubliczny”).
2. Dodaj krótki pionowy film, przygotuj publikację, ustaw termin za ok. 15 minut i zatwierdź.
3. W edytorze sprawdź w Historia → Zlecenia u dostawcy, czy pojawił się `job_id`, a potem czy po terminie status zmienia się na „Opublikowane” i jest link.
4. Jeśli pole `title`/`description` lub opcje platformy trafiają w złe miejsca, dostosuj mapowanie w `src/lib/server/social/provider/upload-post.ts` (`upload()`, `platformFields()`).

---

## 3. Konfiguracja webhooków

- **Adres:** `https://<twoja-domena>/api/hooks/upload-post`. Adres do skopiowania jest też w Ustawienia → Webhook Upload-Post. Wpisz go w panelu Upload-Post (Notifications → Webhook) i zaznacz zdarzenia: `upload_completed`, `social_account_connected`, `social_account_disconnected`, `social_account_reauth_required`, `comment_received`.
- **Zabezpieczenie (ustaw co najmniej jedno):**
  - `UPLOAD_POST_WEBHOOK_SECRET` — weryfikacja podpisu HMAC SHA-256 surowej treści, porównywana w stałym czasie. Akceptowane formaty: `sha256=<hex>`, `<hex>`, base64 oraz `t=<czas>,v1=<hex>`; podpisywane może być `body` albo `<znacznik czasu>.<body>`;
  - `UPLOAD_POST_WEBHOOK_TOKEN` — sekretny token w adresie: `…/api/hooks/upload-post?token=<token>`.

  Gdy jest ustawiony sekret, podpis jest wymagany. Bez żadnego z nich webhook jest wyłączony, a stan i tak uzgadnia rekonsyliacja.
- **Nagłówki** są konfigurowalne, bo nie dało się ich potwierdzić w publicznym SDK. Domyślnie: `x-upload-post-signature`, `x-upload-post-timestamp`, `x-upload-post-delivery`; zmienisz je przez `UPLOAD_POST_SIGNATURE_HEADER`, `UPLOAD_POST_TIMESTAMP_HEADER`, `UPLOAD_POST_DELIVERY_HEADER`. Jeśli Upload-Post nie podpisuje dostarczeń, użyj samego tokenu.
- **Ochrona przed powtórzeniem:** znacznik czasu starszy lub nowszy niż 5 minut jest odrzucany. Identyfikator dostarczenia (albo hash treści) jest unikalny, więc ponowne dostarczenie dostaje „200 duplicate” i nie jest przetwarzane drugi raz.
- **Przetwarzanie:** surowe zdarzenie jest zapisywane (`WebhookEvent`), odpowiedź wraca od razu, a przetwarzanie dzieje się w tle. Treść webhooka służy tylko do ustalenia, czego dotyczy (zlecenie, profil, post). Właściwy stan aplikacja zawsze odczytuje z API dostawcy (`GET /api/uploadposts/status`, synchronizacja profilu, pobranie komentarzy). Obsługiwany jest częściowy sukces: przy żądaniu wieloplatformowym liczy się wynik konkretnej platformy.

---

## 4. Uruchomienie lokalne

```bash
cp .env.example .env            # APP_SECRET, ewentualnie klucze (bez UPLOAD_POST_API_KEY = tryb DEMO)
docker compose up -d            # Postgres (+ MinIO)
npm install
npx prisma migrate deploy
npm run db:seed                 # admin + (bez klucza Upload-Post) dane DEMO: AV Holding / Nowy Etap, Risify, Pravna
npm run dev                     # web + worker
```
Wejdź na `http://localhost:3000/social` (login `admin@askby.local` / `askby-admin`). Dane DEMO można też wczytać w Ustawienia → Dane DEMO.

**Testy:**
```bash
npx tsc --noEmit
npx vitest run                               # w tym tests/unit/social.test.ts
npx playwright test tests/e2e/social.spec.ts # 24 scenariusze akceptacyjne (atrapa Upload-Post i OpenAI)
npx next build
```

---

## 5. Wdrożenie produkcyjne (Railway)

1. Zmiany są w gałęzi wdrożeniowej. Przy starcie aplikacja automatycznie wykonuje migracje i seed (`Dockerfile`).
2. Dodaj w Variables:
   - wymagane do publikacji: `UPLOAD_POST_API_KEY`;
   - zalecane: `UPLOAD_POST_WEBHOOK_SECRET` i/lub `UPLOAD_POST_WEBHOOK_TOKEN`;
   - opcjonalnie: `SOCIAL_SEED_DEMO=false` (bez danych DEMO), `SOCIAL_MAX_UPLOAD_MB`.
3. Ustaw `APP_URL` na publiczny adres HTTPS (na nim opierają się powrót z łączenia kont i link do webhooka).
4. Media: przy wielu filmach zalecany jest magazyn S3/R2 (patrz `DEPLOY_RAILWAY.md`).
5. Worker musi działać (w obrazie startuje razem z aplikacją): bez niego nic nie trafi do dostawcy, a metryki i komentarze się nie odświeżą.
6. Skonfiguruj webhook w panelu Upload-Post (sekcja 3).
7. Pierwsza publikacja: patrz „Pierwsze uruchomienie na żywo”.

**Zmienne Social Media Studio:**

| Zmienna | Opis |
|---|---|
| `UPLOAD_POST_API_KEY` | klucz API (tylko serwer); bez niego tryb DEMO |
| `UPLOAD_POST_BASE_URL` | domyślnie `https://api.upload-post.com/api` |
| `UPLOAD_POST_WEBHOOK_SECRET` | sekret HMAC webhooka |
| `UPLOAD_POST_WEBHOOK_TOKEN` | token w adresie webhooka |
| `UPLOAD_POST_SIGNATURE_HEADER` / `_TIMESTAMP_HEADER` / `_DELIVERY_HEADER` | nazwy nagłówków webhooka |
| `UPLOAD_POST_SEND_EXTERNAL_ID` | `true` = wysyłaj `external_id` w zleceniu (pole niepotwierdzone w SDK, domyślnie `false`; korelacja działa przez `job_id`/`request_id` i `Idempotency-Key`) |
| `SOCIAL_DEMO_MODE` | `true` = wymuś DEMO mimo klucza |
| `SOCIAL_SEED_DEMO` | `false` = nie wczytuj danych DEMO przy starcie |
| `SOCIAL_MAX_UPLOAD_MB` | maks. rozmiar filmu (domyślnie 4096) |
| `SOCIAL_TICK_MS` | co ile ms worker sprawdza terminy / stany (domyślnie 60000) |
| `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL` | AI (generator, komentarze, analityk); domyślnie `gpt-5`, awaryjnie `gpt-4.1` |
| `ELEVENLABS_API_KEY` | transkrypcja filmów (opcjonalnie) |

---

## 6. Funkcje gotowe

- **Organizacje, projekty i zespół:**
  - organizacje i projekty (każdy z własną strefą czasową i językiem);
  - role na poziomie organizacji i projektu;
  - zaproszenia linkiem (14 dni, jednorazowe); klient zakłada konto sam;
  - izolacja danych między klientami.
- **Konta:**
  - łączenie kont przez stronę dostawcy, synchronizacja, „Połącz ponownie”, rozłączenie;
  - wybór strony Facebook / LinkedIn;
  - kilka kont tej samej platformy w projekcie;
  - wykrycie zmiany identyfikatora konta, które unieważnia akceptacje.
- **Ustawienia marki:** opis, grupa docelowa, cel, ton, strona, produkty, USP, CTA, zakazane sformułowania (blokują akceptację), słowa kluczowe, baza wiedzy i dokumenty, zasady moderacji, retencja komentarzy.
- **Biblioteka mediów:**
  - upload porcjami (MP4/MOV), import z URL (ochrona SSRF), import gotowych eksportów z AskBy Studio;
  - miniatura, metadane z FFprobe i ocena zgodności z każdą platformą;
  - wersja pionowa 1080×1920 H.264 tworzona przez FFmpeg — oryginał zostaje bez zmian;
  - transkrypcja przez ElevenLabs.
- **Generator AI:**
  - osobne wersje na każdą platformę w ustrukturyzowanym JSON walidowanym przez Zod, z kontrolą limitów i ponowieniem, gdy dwie platformy dostały ten sam tekst;
  - kontekst z ustawień marki, transkrypcji i historii wyników;
  - regeneracje (krócej, sprzedażowo, edukacyjnie, naturalnie, konkrety, inne CTA, tylko hashtagi), 3 alternatywne otwarcia, propozycja okładki;
  - historia wersji z przywracaniem.
- **Edytor:**
  - film i okładka, zakładki platform, liczniki znaków, hashtagi, CTA, pierwszy komentarz;
  - opcje platform (YouTube: tagi, widoczność; TikTok: prywatność, duety, stitch; IG: feed; FB: Reels lub post);
  - termin w strefie projektu z sugestią godziny: z historii konta, a bez niej z heurystyki opisanej jako hipoteza;
  - podgląd na telefonie i wyraźna informacja, na które konto trafi post.
- **Akceptacje:** kolejka z filmem, kontem, finalnym opisem, terminem i opcjami; akceptuj, odrzuć, poproś o poprawki, zatwierdź wybrane; historia decyzji.
- **Harmonogram:**
  - kalendarz w widokach miesiąc, tydzień, dzień i lista, z filtrami i przeciąganiem terminu;
  - publikacje: historia, anulowanie, ponawianie;
  - niezawodność zleceń (sekcja 1).
- **Webhooki:** opis w sekcji 3.
- **Monitoring i analityka:**
  - snapshoty po 1 h, 24 h, 72 h, 7 i 30 dniach oraz ręczne odświeżenie; brak metryki to `null`, nigdy 0; obserwujący raz dziennie;
  - dashboard 7/30/90 dni z porównaniem okresów, wyświetlenia w czasie (wykres i tabela), wyniki per platforma, top 10, wyniki pojedynczego filmu z linkiem;
  - reach i views pokazywane osobno; zawsze widoczna data danych;
  - „Wnioski AI” z obserwacjami oddzielonymi od hipotez i ostrzeżeniem o małej próbie.
- **Komentarze:**
  - jedna skrzynka z filtrami (projekt, platforma, bez odpowiedzi, wymagające reakcji, pytania, leady, negatywne) i statusami;
  - inteligentny polling i deduplikacja;
  - klasyfikacja AI; dane osobowe są usuwane przed wysłaniem do AI;
  - projekt odpowiedzi AI do akceptacji lub edycji; Instagram: odpowiedź publiczna albo DM;
  - automatyczne odpowiedzi domyślnie wyłączone i ograniczone (opis niżej).
- **Powiadomienia:** w aplikacji, bez duplikatów. Kanał e-mail jest przygotowany (`emailedAt`), ale jeszcze nie wysyła.
- **RODO:** dziennik audytu; usunięcie projektu z wszystkimi danymi (anulowanie zleceń, usunięcie profili u dostawcy i plików); retencja komentarzy.
- **Tryb DEMO:** bez klucza, z danymi dla 3 projektów; wszystko oznaczone DEMO i nigdy nie publikowane naprawdę.

**Automatyczne odpowiedzi** (wyłączone domyślnie):
- tylko kategorie „pozytywne” i „proste pytania”;
- nigdy dla skarg, spraw prawnych, medycznych, danych osobowych, konfliktów ani sytuacji nietypowych;
- limit na godzinę, żadnego identycznego tekstu w ciągu 24 h, nic w wątku z naszą odpowiedzią, żadnych linków ani danych kontaktowych.

## 7. Co wymaga płatnego planu lub dodatkowych uprawnień

Szczegóły planów sprawdź w aktualnym cenniku Upload-Post — nie dało się ich zweryfikować z tego środowiska.
- **Upload-Post:**
  - profile i white-label JWT (łączenie kont klientów), liczba profili i kont;
  - analityka postów i profili, komentarze, liczba publikacji — zależą od planu.
- **Instagram:** konto firmowe lub twórcy powiązane ze stroną Facebook; komentarze i DM wymagają odpowiednich uprawnień aplikacji dostawcy.
- **Facebook:** uprawnienia administratora strony.
- **TikTok:**
  - komentarze wymagają uprawnienia `comments` (ponowne połączenie konta);
  - opcje prywatności zależą od konta;
  - muzyka i lokalizacja tylko z odpowiednimi uprawnieniami.
- **YouTube:** własne miniatury i dłuższe filmy wymagają zweryfikowanego kanału; analityka zależy od uprawnień kanału.
- **LinkedIn:** publikacja na stronie firmy i jej analityka wymagają roli administratora strony; dla profili osobistych LinkedIn nie udostępnia analityki.
- **OpenAI:** płatny klucz dla AI.
- **ElevenLabs:** płatny klucz dla transkrypcji.

## 8. Czego nie przetestowano na żywo

- **Nic nie było publikowane na prawdziwych kontach.**
- Wszystkie wywołania Upload-Post (upload, status, PATCH/DELETE zleceń, profile, JWT, strony, komentarze, analityka) sprawdzono tylko na atrapie. Atrapa odtwarza kształty z oficjalnego SDK, a parsowanie odpowiedzi jest tolerancyjne (`pickNum`/`pickStr`) i zawsze zapisuje surową odpowiedź.
- Niepotwierdzone szczegóły:
  - nazwy nagłówków i format podpisu webhooka (dlatego konfigurowalne);
  - kształt odpowiedzi komentarzy i analityki;
  - pole `external_id` (domyślnie niewysyłane);
  - dokładne mapowanie `title`/`description` na platformy.
- Audience insights dostawcy (np. `/uploadposts/audience` dla TikToka) nie są jeszcze wykorzystywane w sugestii godzin. Kolejność źródeł to: historia konta, potem heurystyka.

## 9. Wyniki testów (29.10.2026)

- `npx tsc --noEmit`: bez błędów.
- `npx next build`: OK.
- Vitest: `tests/unit/social.test.ts`, 18 testów:
  - RBAC, strefy czasowe (z przejściem czasu letniego/zimowego);
  - reguły platform i walidacja wideo;
  - podpis webhooka, parsery odpowiedzi Upload-Post, hash akceptacji;
  - harmonogram monitoringu, engagement rate, polling komentarzy;
  - usuwanie danych osobowych, ochrona przed SSRF.
- Playwright: `tests/e2e/social.spec.ts`, **15 testów (24 scenariusze + DEMO i ekrany), wszystkie zaliczone**:
  1. Utworzenie organizacji (UI)
  2. Dodanie projektu (UI)
  3. Połączenie Instagram + TikTok przez stronę dostawcy (UI)
  4. Drugi projekt
  5. Brak dostępu do danych drugiego klienta (404, filtrowane listy, zamknięte `/api/admin`)
  6. Upload filmu porcjami
  7. Dwa różne opisy AI (bez `#viral`)
  8. Edycja opisu (nowa wersja)
  9. Wysłanie do akceptacji
  10. Publikacja bez akceptacji: 409, nic nie trafia do dostawcy
  11. Akceptacja w kolejce przez klienta (UI, zbiorczo)
  12. Dwa osobne zlecenia z różnymi kluczami
  13. Utracona odpowiedź, rekonsyliacja i ponowne wywołanie: ten sam klucz, brak duplikatu
  14. Anulowanie (DELETE u dostawcy)
  15. Webhook sukcesu: URL i natywne ID zapisane po odczycie z API
  16. Webhook błędu: `PUBLISH_FAILED` z treścią błędu i powiadomienie
  17. Powtórzony, sfałszowany lub przeterminowany webhook: brak ponownego przetworzenia
  18. Analityka: views = 1234, reach/saves = `null`
  19. Pobranie i klasyfikacja komentarzy
  20. Odpowiedź AI (UI)
  21. Edycja, akceptacja i wysłanie odpowiedzi (publiczna odpowiedź IG), brak auto-odpowiedzi
  22. Utrata autoryzacji: `REAUTH_REQUIRED` i powiadomienie
  23. Przywrócenie połączenia: z powrotem `SCHEDULED`
  24. Edycja po akceptacji: wycofana akceptacja, wstrzymane zlecenie, 409, ponowna akceptacja i nowe zlecenie; stara wersja nie do zatwierdzenia
  - dodatkowo **DEMO:** zatwierdzenie posta DEMO idzie tylko do atrapy, zero żądań do API dostawcy; ekrany kalendarza, edytora, analityki, publikacji i przełącznik motywu.

## 10. Decyzje techniczne

- **Kolejka w Postgresie zamiast Redis + BullMQ:** aplikacja już ma niezawodną kolejkę (`SKIP LOCKED`, idempotencja, backoff). Drugi system to dodatkowa usługa i koszt bez realnej korzyści przy tej skali. Ticki to zadania z kluczem na minutę, bez blokad sesyjnych.
- **Logowanie:** istniejące konta i sesje JWT zamiast Auth.js. Klienci dostają konta `MEMBER` przez zaproszenie.
- **Zmiana po akceptacji wstrzymuje zlecenie** zamiast zostawiać starą wersję w kolejce. Bezpieczniej: nie ukaże się tekst, który ktoś właśnie poprawiał (np. ze względów prawnych). `PATCH` jest używany, gdy akceptujący sam przesuwa termin i od razu go zatwierdza.
- **Webhook to wskazówka, nie źródło prawdy:** stan zawsze odczytujemy z API dostawcy, a rekonsyliacja działa także bez webhooków.
- **Film wysyłany jest jako plik** (multipart, strumieniowo z dysku lub S3), a nie jako link — dostawca nie musi mieć dostępu do naszego magazynu.
- **AI to OpenAI** (klucz już skonfigurowany w aplikacji). Logika obsługuje wszystkie 5 platform, w tym LinkedIn; „Upload-Post AI Shorts” nie jest używane.
