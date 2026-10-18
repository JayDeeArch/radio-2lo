CREATE TABLE IF NOT EXISTS dedications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  spotify_track_id   text NOT NULL,
  uri                text NOT NULL,
  track_name         text NOT NULL,
  artist_name        text NOT NULL,
  album_name         text,
  album_image_url    text,
  duration_ms        integer,
  release_year       integer,
  is_explicit        boolean NOT NULL DEFAULT false,
  search_blob        text NOT NULL,

  recipient_name     text NOT NULL,
  sender_name        text,
  is_anonymous       boolean NOT NULL DEFAULT false,
  message            text,
  target_date        date NOT NULL,

  status             text NOT NULL DEFAULT 'OCZEKUJACE',
  reject_reason      text,
  decided_by         uuid REFERENCES admins(id) ON DELETE SET NULL,
  decided_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dedications_status_idx ON dedications(status);
CREATE INDEX IF NOT EXISTS dedications_target_date_idx ON dedications(target_date);