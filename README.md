# 🎧 Szkolne Radio

Platforma, na której uczniowie zgłaszają prośby o utwory na playlistę szkolnego radia,
a administrator odsłuchuje je i jednym kliknięciem dodaje do playlisty Spotify albo odrzuca
z powodem.

- **Uczniowie** szukają utworu, odsłuchują 30-sekundowy fragment i zgłaszają prośbę z klasą (`2A`).
- **Wiele osób może chcieć ten sam utwór** — każde zgłoszenie to głos, a kolejka sortuje się
  według liczby głosów. Administrator widzi też, ile różnych klas chce dany utwór.
- **Wszyscy** widzą tablicę statusów z wyszukiwarką — kto co zgłosił, co dodano, co odrzucono i dlaczego.
- **Administrator** loguje się kontem Spotify i decyduje z panelu: dodaj / odrzuć / cofnij.

### Priorytety

Playlista szkolnego radia gra między długimi przerwami, więc liczba utworów, które da się
dodać, jest ograniczona. Dlatego kolejka nie jest chronologiczna, tylko **oparta na liczbie
głosów**: utwór chciany przez sześć osób z trzech klas wyprzedza taki, na który przyszła
jedna prośba.

| Kolumna w bazie | Znaczenie |
| --- | --- |
| `requests` | jeden wiersz na **utwór** — to on trafia na playlistę |
| `request_votes` | jeden wiersz na **głos** (osoba + klasa) |

Dzięki temu utwór nigdy nie wyląduje na playliscie dwa razy, niezależnie od liczby
głosów. Zgłoszenie utworu, który już czeka, **nie jest odrzucane** — dopisuje głos.
Wyjątkiem jest utwór już zatwierdzony: jest na playliscie, więc kolejny głos nic nie
zmienia i API zwraca `409`.

Głos zatwierdzonego utworu można wycofać przyciskiem „Przywróć do kolejki”.

### Prośba o utwór, który już jest na playliscie

Uczniowie regularnie proszą o utwory, które już gramy — nie zdają sobie sprawy.
Aplikacja sprawdza **samą playlistę** (lokalna kopia `playlist_items`), a nie status
prośby, bo te dwie rzeczy rozjeżdżają się: ktoś może dodać utwór ręcznie w aplikacji
Spotify, albo usunąć go z playlisty zostawiając prośbę zatwierdzoną.

| Sytuacja | Co robi aplikacja |
| --- | --- |
| Utwór na playliscie, brak prośby | zapisuje prośbę od razu jako **W playliscie**, informuje ucznia |
| Utwór na playliscie, prośba czeka w kolejce | awansuje ją na **W playliscie** i dopisuje głos |
| Utwór czeka, ale nie ma go na playliscie | dopisuje głos, zwiększając priorytet |

W każdym przypadku utwór **nie trafi na playlistę drugi raz**. Dodatkowo zatwierdzanie
w panelu administratora sprawdza playlistę przed wysłaniem do Spotify - nawet gdyby
kopia była nieaktualna, nic się nie powieli. Administrator dostaje wtedy czytelny
komunikat z numerem pozycji zamiast błędu.

Głos na utwór już grający jest zapisywany, więc widać, który utwór cieszy się
największym zainteresowaniem - przydatne, gdy trzeba kiedyś skrócić playlistę.

---

## Spis treści

1. [Jak to działa](#jak-to-działa)
2. [Wymagania](#wymagania)
3. [Konfiguracja aplikacji Spotify](#konfiguracja-aplikacji-spotify)
4. [Uruchomienie przez Docker](#uruchomienie-przez-docker)
5. [Tryb deweloperski](#tryb-deweloperski)
6. [Wdrożenie na serwerze](#wdrożenie-na-serwerze)
7. [Dane demonstracyjne](#dane-demonstracyjne)
8. [Struktura projektu](#struktura-projektu)
9. [API](#api)
10. [Uwagi o API Spotify 2026](#uwagi-o-api-spotify-2026)
11. [Bezpieczeństwo](#bezpieczeństwo)
12. [Kopia zapasowa](#kopia-zapasowa)
13. [Rozwiązywanie problemów](#rozwiązywanie-problemów)

---

## Jak to działa

```mermaid
flowchart LR
    U[Uczeń] -->|wyszukuje| W[Frontend]
    W -->|GET /api/suggest| A[API Fastify]
    U -->|wysyła prośbę| W
    W -->|POST /api/requests| A
    A -->|GET /tracks/{id}| S[(Spotify Web API)]
    A --> D[(PostgreSQL)]

    A -->|SSE /api/events| W
    ADM[Administrator] -->|loguje się kontem Spotify| A
    ADM -->|zatwierdza| A
    A -->|POST /playlists/{id}/items| S
    A -->|co 15 min: synchronizacja| S
    A --> D
```

**Dlaczego uczniowie nie logują się?** Żeby aplikacja działała w trybie deweloperskim
Spotify, który dopuszcza tylko 5 zalogowanych użytkowników. Skoro uczniowie podają tylko
klasę, a konto Spotify ma tylko administrator, limit nie stanowi problemu.

**Dlaczego odtwarzacz to IFrame, a nie Web Playback SDK?** IFrame `open.spotify.com/embed`
działa dla każdego, także bez Premium, i nie zużywa limitu zapytań Web API. Web Playback SDK
wymagałby Premium i logowania każdego ucznia.

---

## Wymagania

- Docker 24+ z Compose v2 (`docker compose`)
- Konto Spotify Premium będące **współwłaścicielem** playlisty szkolnego radia
- Aplikacja w [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)

---

## Konfiguracja aplikacji Spotify

1. Wejdź na <https://developer.spotify.com/dashboard> i wybierz **Create app**.
2. W sekcjiji **Redirect URIs** dodaj dokładnie ten adres, który podasz w `SPOTIFY_REDIRECT_URI`:
   - lokalnie: `http://localhost:8080/api/auth/spotify/callback`
   - produkcja: `https://twoja-domena.pl/api/auth/spotify/callback`
3. Skopiuj **Client ID** i **Client Secret** do pliku `.env`.
4. Upewnij się, że playlista jest **współdzielna**. W Spotify: prawy przycisk na playliscie →
   **Udostępnij** → **Zezwól na edycję**. Bez tego API nie zwróci zawartości playlisty
   ani nie pozwoli niczego do niej dodać.
5. Wyciągnij ID playlisty z linku:
   ```
   https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
                                                  └──── ID ────┘
   ```

Zakresy OAuth, o które aplikacja poprosi przy pierwszym logowaniu:

| Zakres | Do czego |
| --- | --- |
| `playlist-read-private` | odczyt playlisty (pozwala wykrywać ręczne zmiany) |
| `playlist-modify-public` | dodawanie i usuwanie utworów |
| `playlist-modify-private` | to samo dla playlist prywatnych i współdzielonych |

> **Tryb deweloperski vs produkcyjny.** Aplikacja w trybie deweloperskim pozwala zalogować się
> maksymalnie 5 użytkownikom. Dla szkoły to wystarczy (loguje się tylko administrator),
> ale poza zaufanym adresem IP i po wygaśnięciu 6-miesięcznego limitu dzierżawy warto przejść
> w tryb produkcyjny w panelu Spotify.

---

## Uruchomienie przez Docker

```bash
cp .env.example .env
$EDITOR .env          # uzupełnij klucze, hasło i ID playlisty

openssl rand -base64 48   # wygeneruj SESSION_SECRET i wklej do .env

docker compose up -d --build
```

Aplikacja będzie dostępna pod `http://localhost:8080`.

Sprawdzenie stanu:

```bash
docker compose ps
docker compose logs -f api
curl http://localhost:8080/api/health
```

**Pierwszy krok po uruchomieniu:** wejdź na `http://localhost:8080/admin`
i zaloguj się kontem Spotify. Dopiero wtedy panel będzie mógł dodawać utwory.

---

## Tryb deweloperski

Przeładowanie kodu bez budowania obrazów — wygodne przy pracy nad wyglądem.

```bash
# terminal 1: tylko baza i API
docker compose up -d db api

# terminal 2: Vite z HMR na porcie 5173
pnpm install
pnpm dev
```

Panel admina: <http://localhost:5173/admin>

---

## Dane demonstracyjne

Opcjonalnie — kilka przykładowych prośb w różnych statusach, żeby zobaczyć wygląd tablicy:

```bash
docker compose exec api node apps/api/dist/db/seed.js
```

Skrypt pobiera metadane utworów **na żywo ze Spotify** po identyfikatorach, więc tytuły,
wykonawcy i okładki zawsze odpowiadają rzeczywistości.

Wykasowanie danych demonstracyjnych:

```bash
docker compose exec -T db psql -U radio -d radio -c "TRUNCATE requests, request_events CASCADE;"
```

**Na produkcji z prawdziwymi uczniami nie uruchamiaj** seedów - wstawiają prośby,
których nikt nie zgłosił.

---

## Struktura projektu

```
.
├── apps
│   ├── api/                     Fastify 5 + Drizzle + PostgreSQL
│   │   ├── src
│   │   │   ├── db/
│   │   │   │   ├── schema.ts    Definicja tabel (Drizzle)
│   │   │   │   ├── migrations/  SQL migrujany przy starcie
│   │   │   │   ├── migrate.ts   Własny runner z kontrolą sum (SHA-256)
│   │   │   │   └── seed.ts      Dane demonstracyjne
│   │   │   ├── spotify/
│   │   │   │   ├── types.ts     Kształt odpowiedzi API (po migracji 2026)
│   │   │   │   ├── tokens.ts    Client Credentials + OAuth z PKCE, odświeżanie
│   │   │   │   └── client.ts    Wywołania Web API, backoff na 429
│   │   │   ├── lib/             Sesje, limit zgłoszeń, SSE, ustawienia
│   │   │   ├── routes/          auth, public, admin
│   │   │   ├── services/        requests (+głosy), moderation, sync (reconciler)
│   │   │   └── scripts/
│   │   │       └── spotify-spike.ts   Weryfikacja integracji przed wdrożeniem
│   │   └── Dockerfile
│   └── web/                     React 19 + Vite + Tailwind v4 + Motion
│       ├── src
│       │   ├── components/      TrackCard, QueueCard, Primitives
│       │   ├── pages/           Home, Status, Playlist, Admin
│       │   └── lib/             Klient API, formatowanie, strumień SSE
│       ├── nginx.conf           Serwowanie statyczne + proxy /api
│       └── Dockerfile
├── packages/shared/             Schematy Zod + typy wspólne dla obu aplikacji
├── docker-compose.yml           Stos produkcyjny
└── docker-compose.dev.yml  Stos deweloperski (HMR)
```

---

## API

### Publiczne

| Metoda | Ścieżka | Opis |
| --- | --- | --- |
| `GET` | `/api/suggest?q=&offset=` | Wyszukiwarka Spotify (10 wyników na stronę) |
| `POST` | `/api/requests` | Zgłoszenie prośby `{ track, class, note? }` |
| `GET` | `/api/requests?q=&status=&class=&sort=&page=` | Tablica statusów z licznikami i liczbą głosów |
| `GET` | `/api/requests/:id` | Szczegóły prośby wraz z historią |
| `GET` | `/api/playlist?q=` | Playlista z **lokalnej kopii** + wyszukiwarka |
| `GET` | `/api/events` | Server-Sent Events (aktualizacje na żywo) |

### Administrator

| Metoda | Ścieżka | Opis |
| --- | --- | --- |
| `GET` | `/api/auth/spotify/login` | Przekierowanie do autoryzacji Spotify |
| `GET` | `/api/auth/spotify/callback` | Powrót z kodem OAuth |
| `GET` | `/api/auth/me` | Dane admina + stan połączenia i tokenu |
| `POST` | `/api/auth/logout` | Wylogowanie |
| `GET` | `/api/admin/queue?sort=priorytet` | Kolejka oczekujących wg liczby głosów |
| `GET` | `/api/admin/requests` | Historia z filtrami |
| `POST` | `/api/admin/requests/:id/approve` | Dodaj do playlisty |
| `POST` | `/api/admin/requests/:id/reject` | Odrzuć `{ reason }` |
| `POST` | `/api/admin/requests/:id/undo` | Cofnij do kolejki |
| `POST` | `/api/admin/sync` | Wymuś synchronizację ze Spotify |
| `GET` | `/api/admin/orphans` | Utwory na playliscie bez prośby w bazie |
| `GET` | `/api/admin/activity` | Ostatnie zdarzenia |

### Skróty klawiszowe panelu

| Klawisz | Działanie |
| --- | --- |
| `J` / `↓` | Następna prośba |
| `K` / `↑` | Poprzednia prośba |
| `A` | Dodaj do playlisty |
| `R` | Odrzuć |
| `U` | Przywróć do kolejki |

Na stronie statusów klawisz `/` przenosi fokus do wyszukiwarki.

---

## Uwagi o API Spotify 2026

Spotify kilkukrotnie zmieniał Web API i **stare tutoriale są nieaktualne**. Poniżej zmiany,
które realnie wpływają na tę aplikację — kod jest napisany zgodnie z nimi.

| Potrzeba | Było (nie działa) | Jest używane |
| --- | --- | --- |
| Dodanie do playlisty | `POST /playlists/{id}/tracks` | `POST /playlists/{id}/items` |
| Odczyt playlisty | `GET /playlists/{id}/tracks` | `GET /playlists/{id}/items` |
| Usunięcie z playlisty | `DELETE /playlists/{id}/tracks` | `DELETE /playlists/{id}/items` |
| Wyszukiwanie | `?limit=50` | `?limit=10` — maksimum spadło do 10 |
| Metadane wielu utworów | `GET /tracks?ids=a,b,c` | **usunięte** — pobieramy po jednym |
| „Najpopularniejsze utwory” | `track.popularity` | **usunięte** — liczymy prośby w bazie |
| Śledzenie playlisty | `PUT /playlists/{id}/followers` | `PUT /me/library` |

**Dlaczego metadane trzymamy u siebie?** Endpoint `GET /tracks?ids=` przestał istnieć, więc
pobieranie metadanych przy każdym wyświetleniu listy byłoby bardzo kosztowne (i łatwo
przekroczyłoby limit zapytań). Dlatego przy zgłoszeniu robimy jeden `GET /tracks/{id}`
i zapisujemy wynik w kolumnach `requests`. Wyszukiwanie na liście działa po bazie.

### Trzy pułapki, na które trzeba uważać

1. **Token admina wygasa po 6 miesiącach.** Od czerwca 2026 nowe aplikacje, a od lipca 2026
   istniejące, otrzymują refresh tokeny z 6-miesięcznym cyklem życia liczonym **od pierwotnej
   zgody użytkownika**. Odświeżenie access tokenu **nie resetuje** tego zegara. Aplikacja
   pilnuje tego sama i pokazuje banner na 30/14/7 dni przed wygaśnięciem. Ustaw kalendarz
   przypomnienie na odnowienie logowania co 5 miesięcy.

2. **Limit zapytań jest wspólny dla całego konta dewelopera.** Od lipca 2026 limity w trybie
   deweloperskim liczone są per konto, nie per Client ID, a odpowiedź `429` zawiera
   `error.reason = "QUOTA_EXCEEDED"`. Aplikacja obsługuje to exponential backoffiem
   i nagłówkiem `Retry-After`.

3. **Playlista musi być współdzielona.** API zwraca zawartość playlisty tylko jej właścicielowi
   albo współwłaścicielowi. Przy samej obserwacji `items` będzie puste i zapisy nie zadziałają.

### Kopia playlisty i jej wyszukiwarka

`/api/playlist` **nie odpytuje Spotify**. Zawartość jest zapisywana w tabeli
`playlist_items` przez harmonogram synchronizacji (co 15 min) oraz od razu po każdej
decyzji administratora. Dzięki temu wejście ucznia na stronę playlista nie zużywa
limitu zapytań — wcześniej pobieranie 326 utworów oznaczało 4 wywołania do API przy
każdym załadowaniu strony, a limit konta dewelopera jest wspólny dla wszystkich
Twoich aplikacji.

- Kopia przeterminowana po 10 minutach odświeża się przy pierwszym wejściu.
- Jeśli odświeżenie się nie uda (np. wygasły token administratora), dane zostają
  serwowane z kopii, a kolejne próby są thumione na 5 minut — inaczej każde wejście
  na stronę generowałoby nieudane zapytania do Spotify.
- Wyszukiwarka na stronie playlisty działa **w przeglądarce** na pobranej liście,
  więc nie ma dodatkowych zapytań przy każdym naciśnięciu klawisza. Poprawność
  odpowiada serwerowemu `word_similarity` (próg 0.5) dla API.

### Głosy — weryfikacja ręczna

```bash
# 2A zgłasza utwór
curl -X POST https://radio.jdkm.cc/api/requests -H 'content-type: application/json' \
  -d '{"track":"0DiWol3AO6WpXZgp0goxAV","class":"2A"}'
# -> alreadyRequested: false, votes: 1

# 3B zgłasza TEN SAM utwór - nie jest odrzucane, dostaje swój głos
curl -X POST https://radio.jdkm.cc/api/requests -H 'content-type: application/json' \
  -d '{"track":"0DiWol3AO6WpXZgp0goxAV","class":"3B"}'
# -> alreadyRequested: true, votes: 2, classCount: 2

# kolejka posortowana wg priorytetu
curl 'https://radio.jdkm.cc/api/requests'
```

Limit: 5 zgłoszeń na 10 minut na adres IP. Licznik żyje w pamięci procesu, więc restart
API go zeruje. Kolejność sortowania zmienia parametr `sort`: `priorytet` (domyślnie),
`nowe`, `losowe`.

### Weryfikacja przed wdrożeniem

```bash
# wymaga: konto admina zalogowane wcześniej przez /admin
pnpm spike
```

Skrypt sprawdza sześć rzeczy, w tym czy współwłaściciel może faktycznie **dodać** utwór
do playlisty (dodaje i natychmiast usuwa testowy utwór). Jeśli ten krok nie przejdzie,
panel administratora nie zadziała — warto sprawdzić przed resztą.

---

## Bezpieczeństwo

- **Ciasteczko sesji** jest `httpOnly`, `SameSite=Lax` i `Secure` w produkcji. W bazie
  trzymany jest wyłącznie SHA-256 tokenu, nie sam token.
- **Logowanie wyłącznie przez Spotify** — brak haseł do zarządzania. Dostęp do panelu
  ogranicza lista `ADMIN_SPOTIFY_IDS`.
- **OAuth z PKCE** (`S256`) i jednorazowym `state` — ochrona przed CSRF w przepływie
  autoryzacyjnym.
- **Limit zgłoszeń**: 5 prośb na 10 minut na adres IP. Klucz pochodzi z `X-Forwarded-For`,
  więc za Caddy/nginx poprawnie widzi prawdziwy adres ucznia.
- **Walidacja wejścia** (Zod) po stronie serwera — klasa ma ściśly format, nota limit 280 znaków.
- **Brak sekretów w obrazie** — `SPOTIFY_CLIENT_SECRET` trafia do kontenera wyłącznie
  przez zmienne środowiskowe z pliku `.env`, którego nie ma w repozytorium.
- **Helmet** nagłówki bezpieczeństwa po stronie API, własne nagłówki w konfiguracji nginx.

### Dobre praktyki na produkcji

- Wpisz `ADMIN_SPOTIFY_IDS` — pusta lista oznacza, że zalogować może się każde konto Spotify,
  a link do panelu nie jest sekretem.
- Przejdź w tryb produkcyjny w panelu Spotify (koniec 5-user limit i 6-miesięcznej dzierżawy).
- Nie publikuj portu bazy danych — w compose jest celowo zamknięty.
- Rozważ `--read-only` i `--cap-drop ALL` dla kontenerów, jeśli Twoja wersja Dockera to wspiera.

---

## Kopia zapasowa

Wystarczy kopia bazy PostgreSQL. Token admina i sesje są w tej samej bazie, więc po
przywróceniu logowanie nadal działa.

```bash
# kopia
docker compose exec -T db pg_dump -U radio -Fc radio > radio-$(date +%F).dump

# przywracanie
doas cp radio-2026-09-29.dump ~/apps/szkolne-radio/
docker compose exec -T db pg_restore -U radio -d radio --clean --if-exists < radio-2026-09-29.dump
docker compose restart api
```

Warto nastawić `cron`:

```cron
0 3 * * * cd ~/apps/szkolne-radio && docker compose exec -T db pg_dump -U radio -Fc radio > /home/jay/backups/radio-$(date +\%F).dump
```

---

## Rozwiązywanie problemów

| Objaw | Przyczyna i rozwiązanie |
| --- | --- |
| `Nie znaleziono kontenera #root` | Build frontendu się nie powiódł — `docker compose logs web`. |
| `redirect_uri_mismatch` przy logowaniu | `SPOTIFY_REDIRECT_URI` różni się od adresu w panelu Spotify (w tym literówka w `https`). |
| `invalid_client` | Błędny `SPOTIFY_CLIENT_ID`/`SECRET` albo niedokończone wdrożenie w panelu. |
| Playlista pusta w panelu | Playlista nie jest współdzielona, albo konto admina nie jest współwłaścicielem. Sprawdź w Spotify → Udostępnij. |
| `Spotify zwróciło HTTP 403` przy dodawaniu | Konto nie ma prawa zapisu. Potwierdź, że to współwłaściciel, nie obserwator. |
| Ban na 429 w panelu | Przekroczono limit zapytań konta dewelopera. Odczekaj kilka minut; nie klikaj „Dodaj” wielokrotnie. |
| „Połączenie ze Spotify wygasło” | Minęło 6 miesięcy od zgody. Kliknij banner i zaloguj się ponownie. |
| Statusy nie aktualizują się na żywo | Nginx buforuje `/api/events`. Sprawdź, czy `proxy_buffering off` jest w `nginx.conf`. |
| Prośby zgłaszają się jako duplikaty | Działa indeks `requests_active_track_uniq` — utwór może być w kolejce lub na playliscie tylko raz. Odrzucony można zgłosić ponownie. |
| Wyszukiwarka nie znajduje polskich znaków | Wyszukiwanie jest celowo odporne na diakrytyki („zol” znajdzie „Żółw”). Jeśli nie działa, sprawdź rozszerzenie `pg_trgm`: `docker compose exec db psql -U radio -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'`. |
| `postgres://…@db:5432` nie działa poza Dockerem | `db` to nazwa usługi w sieci Docker. Lokalnie użyj `localhost` i własnego Postgresa. |

### Reset do stanu początkowego

```bash
docker compose down -v      # -v usuwa też wolumen z bazą!
docker compose up -d --build
```

---

## Licencja i prywatność

Aplikacja przechowuje wyłącznie metadane utworów (tytuł, wykonawca, okładka) oraz klasę
zgłaszającego. Nie pobiera i nie przetwarza plików audio. Odtwarzanie odbywa się przez
osadzony odtwarzacz Spotify, który podlega
[Polityce Prywatności Spotify](https://www.spotify.com/pl/polityka-prywatnosci/).
