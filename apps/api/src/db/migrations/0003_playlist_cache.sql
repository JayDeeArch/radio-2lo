-- Lokalna kopia zawartości playlisty szkolnego radia.
--
-- Do tej pory `/api/playlist` odpytywał Spotify przy KAŻDYM załadowaniu strony
-- i pobierał całą playlistę (326 utworów = 4 strony po 100). Przy jednoczesnych
-- wejściach kilkudziesięciu uczniów to kilkaset wywołań na godzinę, które
-- wyjadały limit zapytań konta dewelopera (który od lipca 2026 jest wspólny
-- dla wszystkich Client ID w koncie).
--
-- Harmonogram synchronizacji i tak pobiera całą playlistę co 15 minut, więc
-- zapisujemy wynik tutaj. Publiczny endpoint czyta wyłącznie z bazy i nie
-- zużywa limitu Spotify w ogóle.

CREATE TABLE IF NOT EXISTS playlist_items (
  -- Pozycja na playliscie, 0-based - tak jak numeruje Spotify.
  -- Kluczem pozycja, nie ID utworu, bo ten sam utwór może wystąpić kilka razy.
  position       integer PRIMARY KEY,
  spotify_track_id text NOT NULL,
  track_name     text NOT NULL,
  artist_name    text NOT NULL,
  album_name     text,
  album_image_url text,
  duration_ms    integer,
  release_year   integer,
  is_explicit    boolean NOT NULL DEFAULT false,
  external_url   text NOT NULL,
  added_at       timestamptz,
  -- Tytuł + artyści + album, bez polskich znaków - pod pg_trgm.
  search_blob    text NOT NULL,
  synced_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS playlist_items_track_idx
  ON playlist_items (spotify_track_id);

-- Wyszukiwarka na playliscie z odpornością na polskie znaki i literówki.
CREATE INDEX IF NOT EXISTS playlist_items_search_idx
  ON playlist_items USING gin (search_blob gin_trgm_ops);
