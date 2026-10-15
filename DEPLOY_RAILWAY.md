# Wdrożenie AskBy Studio na Railway

Repozytorium zawiera `Dockerfile` i `railway.json`, więc Railway sam zbuduje obraz razem z FFmpeg. Przy każdym starcie aplikacja:

1. tworzy tabele w bazie (migracje),
2. zakłada konto administratora i projekt demo (tylko przy pierwszym uruchomieniu),
3. uruchamia aplikację WWW oraz proces przetwarzający nagrania i rendery.

## 1. Baza danych
W projekcie Railway kliknij **+ Create → Database → Add PostgreSQL**.

## 2. Usługa aplikacji (repozytorium)
Kliknij usługę z repozytorium `askanswer`.

**Settings → Source**
- Branch: `claude/pensive-goldberg-4v14gw` (to obecnie domyślna gałąź repozytorium).

**Settings → Networking**
- Kliknij **Generate Domain**. Dostaniesz adres `https://….up.railway.app`.
- Jeśli Railway zapyta o port, podaj `3000`. Aplikacja i tak używa zmiennej `PORT`, którą ustawia Railway.

## 3. Dysk na nagrania (Volume)
Kliknij usługę aplikacji prawym przyciskiem (albo **+ Create → Volume**) i dodaj Volume:
- **Mount path:** `/data`

Bez tego nagrania znikną przy każdym ponownym wdrożeniu.

## 4. Zmienne środowiskowe
Wejdź w usługę aplikacji, zakładka **Variables**, i wybierz **Raw Editor**. Wklej poniższe i uzupełnij swoje wartości:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
APP_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
APP_SECRET=WKLEJ_TU_LOSOWY_CIAG_MIN_32_ZNAKI
ADMIN_EMAIL=twoj@email.pl
ADMIN_PASSWORD=TwojeMocneHaslo123
ELEVENLABS_API_KEY=twoj_klucz_elevenlabs
ELEVENLABS_VOICE_ID=pNInz6obpgDQGcFmaJgB
ELEVENLABS_TTS_MODEL=eleven_multilingual_v2
ELEVENLABS_STT_MODEL=scribe_v2
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=/data
RENDER_CONCURRENCY=2
HIGGSFIELD_CREDENTIALS=TWOJ_KEY_ID:TWOJ_KEY_SECRET
ANTHROPIC_API_KEY=twoj_klucz_anthropic
```

Uwagi do zmiennych:
- **`APP_SECRET`**: dowolny długi, losowy ciąg. Możesz go wygenerować np. na https://www.random.org/strings/ albo komendą `openssl rand -base64 48`. **Nie zmieniaj go później**, bo przestaną działać wygenerowane linki do nagrań.
- **`ADMIN_PASSWORD`**: minimum 10 znaków. Hasło jest ustawiane tylko przy pierwszym starcie, więc późniejsza zmiana tej zmiennej nie zmieni hasła.
- **`ELEVENLABS_VOICE_ID`**: domyślny głos lektora. Później zmienisz go w ustawieniach projektu, wybierając z listy głosów na Twoim koncie.
- **`HIGGSFIELD_CREDENTIALS`**: klucz API Higgsfield w postaci `KEY_ID:KEY_SECRET` (oba fragmenty z panelu API Higgsfield, połączone dwukropkiem). Włącza generowanie scen wideo w zakładce **AI** w Studio. Domyślny model to Kling 3.0 Pro; inny ustawisz zmienną `HIGGSFIELD_MODEL` (np. `bytedance/seedance-2.5/text-to-video`) albo wybierzesz w Studio.
- **`ANTHROPIC_API_KEY`** (opcjonalnie): klucz z console.anthropic.com. Wtedy propozycje scen i prompty przygotowuje Claude na podstawie tego, co mówi ekspert. Bez klucza działa tryb podstawowy (prostsze propozycje).
- **`Postgres`** w `${{Postgres.DATABASE_URL}}` to nazwa usługi bazy. Jeśli Railway nazwał ją inaczej, popraw tę nazwę.

Zapisz zmiany i kliknij **Deploy**. Pierwszy build trwa około 5–8 minut.

## 5. Gotowe
Otwórz `https://twoja-domena.up.railway.app/login` i zaloguj się danymi `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

- Link do nagrywania dla eksperta kopiujesz w **Projekt → Eksperci i linki → Kopiuj link**. Działa na telefonie, bo adres ma HTTPS.
- Jeśli coś nie działa, sprawdź **Deployments → View logs**:
  - linie `[web]` dotyczą aplikacji,
  - linie `[worker]` dotyczą przetwarzania i renderów.

## Koszty i wydajność
- **Rendery** obciążają procesor. `RENDER_CONCURRENCY=2` ogranicza ich równoległość. Przy większym planie Railway możesz ustawić 3–4, żeby przyspieszyć eksport.
- **Nagrania** zajmują ok. 50–150 MB na minutę (oryginał + kopia robocza). Rozmiar Volume możesz powiększyć w jego ustawieniach.
