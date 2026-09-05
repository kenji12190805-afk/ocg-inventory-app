-- ============================================================================
-- ocg-inventory-app : app-local (user data) schema
--
-- This is the schema for the tables the APP creates and owns on-device
-- (Capacitor SQLite). Unlike schema.sql, none of this is shipped by the
-- pipeline or overwritten on sync. Foreign keys into the synced dataset
-- (cards.id / card_prints.id) are NOT declared as SQL FOREIGN KEY constraints
-- here, since those tables live in the synced (and periodically replaced)
-- dataset file -- see OPEN QUESTIONS in SCHEMA.md for how the two are wired
-- together at the app layer (single db vs ATTACH).
-- ============================================================================

-- User-editable list of physical storage locations ("バインダー3", "デッキボックスA", ...).
-- Combobox-style in the UI: pick an existing one, or type a new one that gets
-- added here.
CREATE TABLE IF NOT EXISTS storage_locations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- One row per (card print, i.e. specific set+rarity) the user owns any copies of.
-- print_id references the synced dataset's card_prints.id.
CREATE TABLE IF NOT EXISTS inventory (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  print_id              INTEGER NOT NULL,
  quantity              INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  storage_location_id   INTEGER REFERENCES storage_locations(id) ON DELETE SET NULL,
  note                  TEXT NOT NULL DEFAULT '',
  updated_at            TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_print_id ON inventory(print_id);

-- Registered decks, for the shortage-check feature (compare against inventory).
CREATE TABLE IF NOT EXISTS decks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- card_id references the synced dataset's cards.id (not a specific print --
-- shortage checking is done at the card level, then the user picks which
-- print(s) to count/register against, matching the brief's core flow).
CREATE TABLE IF NOT EXISTS deck_cards (
  deck_id    INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  card_id    INTEGER NOT NULL,
  quantity   INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 3),
  PRIMARY KEY (deck_id, card_id)
);

-- User-entered real-world price sightings (Mercari, 駿河屋, ヤフオク, a shop, ...) for a
-- specific print (set+rarity), since JP secondhand price varies a lot by rarity/print and
-- there is no free/official API for the actual JP market (see schema.sql's card_prices
-- comment) -- this is how the app gets a real price trend at all: the user logs what they
-- actually saw, one entry at a time. print_id references the synced dataset's
-- card_prints.id, same as inventory.
CREATE TABLE IF NOT EXISTS price_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  print_id      INTEGER NOT NULL,
  price_jpy     INTEGER NOT NULL CHECK (price_jpy >= 0),
  source        TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  observed_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_log_print_id ON price_log(print_id);
