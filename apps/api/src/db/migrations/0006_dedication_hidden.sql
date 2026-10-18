ALTER TABLE dedications ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS dedications_hidden_idx ON dedications(hidden);