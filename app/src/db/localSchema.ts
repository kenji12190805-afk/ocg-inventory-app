// Mirrors data-pipeline/app-local-schema.sql (kept in sync manually -- see that file for
// design rationale). IF NOT EXISTS makes this safe to run on every app startup.
export const LOCAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS storage_locations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventory (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  print_id              INTEGER NOT NULL,
  quantity              INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  storage_location_id   INTEGER REFERENCES storage_locations(id) ON DELETE SET NULL,
  note                  TEXT NOT NULL DEFAULT '',
  updated_at            TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_print_id ON inventory(print_id);

CREATE TABLE IF NOT EXISTS decks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deck_cards (
  deck_id    INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  card_id    INTEGER NOT NULL,
  quantity   INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 3),
  PRIMARY KEY (deck_id, card_id)
);

CREATE TABLE IF NOT EXISTS price_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  print_id      INTEGER NOT NULL,
  price_jpy     INTEGER NOT NULL CHECK (price_jpy >= 0),
  source        TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  observed_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_log_print_id ON price_log(print_id);
`;
