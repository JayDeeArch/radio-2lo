-- Lista kont Spotify uprawnionych do logowania do panelu administratora.
-- Pozwala dodawać administratorów bez restartu API i bez edycji .env.
CREATE TABLE IF NOT EXISTS admin_allowlist (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_id  text NOT NULL UNIQUE,
  added_by    uuid REFERENCES admins(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_allowlist_spotify_idx ON admin_allowlist(spotify_id);