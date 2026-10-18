-- Głosy na utwór: wielu uczniów może chcieć tego samego utworu.
--
-- Do tej pory prośba była jedynkowa - powtórne zgłoszenie tego samego utworu
-- było odrzucane (HTTP 409). Teraz każde zgłoszenie to osobny głos, a kolejka
-- administratora daje się sortować po liczbie głosów.
--
-- Tabela `requests` nadal opisuje JEDEN utwór (wiersz na utwór), a `request_votes`
-- przechowuje wszystkich chętnych. Dzięki temu utwór trafia na playlistę
-- tylko raz, niezależnie od liczby osób, które go chcą.

CREATE TABLE IF NOT EXISTS request_votes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  class      text NOT NULL,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS request_votes_request_idx ON request_votes (request_id, created_at);
CREATE INDEX IF NOT EXISTS request_votes_class_idx   ON request_votes (class);

-- Migracja danych: każda dotychczasowa prośba staje się pierwszym głosem
-- na swoim utworze, więc liczniki w panelu nie znikną przy wdrożeniu.
INSERT INTO request_votes (request_id, class, note, created_at)
SELECT id, class, note, created_at
FROM requests
ON CONFLICT DO NOTHING;

-- Indeks wymagany do sortowania po priorytecie: liczba głosów na utwór.
CREATE INDEX IF NOT EXISTS requests_active_track_idx
  ON requests (spotify_track_id)
  WHERE status <> 'ODRZUCONE';
