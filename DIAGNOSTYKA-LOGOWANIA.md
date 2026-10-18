# Diagnostyka logowania administratora

Serwer: 192.168.55.40 (przez VPN: 10.8.0.6) · katalog: ~/apps/szkolne-radio

## 1. Czy nowy administrator w ogóle próbował się logować?

```bash
cd ~/apps/szkolne-radio
docker compose logs api --since 24h | grep "Logowanie odrzucone"
```

Wypisze identyfikatory, które Spotify zwrócił dla tego konta, np.:

```
{"spotifyId":"31fko...","accountId":"xxx", "msg":"Logowanie odrzucone - konto spoza listy dozwolonych"}
```

**To jest ta wartość, której szukasz.** Dokładnie tę dopisz do `ADMIN_SPOTIFY_IDS`.
Może się różnić od ID z linku `open.spotify.com/user/...`.

## 2. Jeśli logów nie ma

Nowa osoba nie doszła do końca logowania. W kolejności przyczyn:

**a) Nie kliknęła „Zezwól" na ekranie zgody Spotify** → w adresie po powrocie
widoczne `?error=denied`. Musi zaznaczyć zgodę na dostęp do playlisty.

**b) Zgoda na pliki cookie** → sesja zapisywana jest w ciasteczku `radio_sesja`
(`Secure`, `SameSite=Lax`). W Firefox/Safari z „blokowaniem śledzenia międzywitrynowego"
trzeba to zezwolić dla tej domeny, inaczej logowanie wygląda na udane,
a po powrocie znów widać ekran logowania.

**c) Inna domena** → logując się przez adres inny niż `https://radio.jdkm.cc`
zgoda wraca pod zły `redirect_uri` i Spotify odrzuca prośbę.

## 3. Szybki test zalogowania

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://radio.jdkm.cc/api/auth/me
# 401 = brak sesji (normalne)
curl -s -o /dev/null -w "%{http_code}\n" https://radio.jdkm.cc/api/admin/queue
# 401 = sesja nie istnieje; 403/502 = sesja OK, ale brak praw do Spotify
```

## 4. Stan obecnej listy dostępu

```bash
cd ~/apps/szkolne-radio
docker compose exec api node apps/api/dist/scripts/admin-accounts.js
```

Wypisuje: powiązane konta, listę dozwolonych, ile dni zostało do wygaśnięcia
tokenu Spotify oraz instrukcję dodania kolejnego administratora.

## 5. Dodanie identyfikatora (ręcznie)

```bash
cd ~/apps/szkolne-radio
nano .env
# ADMIN_SPOTIFY_IDS=31rzvkzb2qvsjukzujquxrhovhz4,31fkopjokjfwjdbbxoofuadw5y3i
docker compose up -d api
```

Po restarcie sprawdź, że lista się wczytała:

```bash
docker compose exec api node apps/api/dist/scripts/admin-accounts.js | grep -A3 "Lista dostępu"
```
