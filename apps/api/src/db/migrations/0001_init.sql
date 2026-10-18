-- Szkolne Radio - schemat bazy
-- PostgreSQL 16+, rozszerzenia pg_trgm (fuzzy search) i unaccent (polskie znaki).

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS admins (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_id     text NOT NULL UNIQUE,
  account_id     text,
  display_name   text NOT NULL,
  avatar_url     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  text PRIMARY KEY,
  admin_id    uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_admin_idx   ON sessions (admin_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_track_id text NOT NULL,
  uri              text NOT NULL,
  track_name       text NOT NULL,
  artist_name      text NOT NULL,
  album_name       text,
  album_image_url  text,
  duration_ms      integer,
  release_year     integer,
  is_explicit      boolean NOT NULL DEFAULT false,
  search_blob      text NOT NULL,

  class            text NOT NULL,
  note             text,

  status           text NOT NULL DEFAULT 'OCZEKUJACE'
                     CHECK (status IN ('OCZEKUJACE', 'ZATWIERDZONE', 'ODRZUCONE')),
  reject_reason    text,
  decided_at       timestamptz,
  decided_by       uuid REFERENCES admins(id) ON DELETE SET NULL,

  spotify_sync     text NOT NULL DEFAULT 'NOT_REQUIRED'
                     CHECK (spotify_sync IN ('NOT_REQUIRED', 'PENDING', 'OK', 'ERROR')),
  spotify_error    text,
  spotify_added_at timestamptz,
  spotify_position integer,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Duplikaty: co najwyżej jeden aktywny wiersz na utwór (odrzucone można zgłosić ponownie).
CREATE UNIQUE INDEX IF NOT EXISTS requests_active_track_uniq
  ON requests (spotify_track_id)
  WHERE status <> 'ODRZUCONE';

CREATE INDEX IF NOT EXISTS requests_search_trgm
  ON requests USING gin (search_blob gin_trgm_ops);

CREATE INDEX IF NOT EXISTS requests_status_created_idx ON requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS requests_class_idx           ON requests (class);
CREATE INDEX IF NOT EXISTS requests_track_idx           ON requests (spotify_track_id);

CREATE TABLE IF NOT EXISTS request_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  admin_id    uuid REFERENCES admins(id) ON DELETE SET NULL,
  action      text NOT NULL,
  from_status text,
  to_status   text,
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS request_events_request_idx ON request_events (request_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
