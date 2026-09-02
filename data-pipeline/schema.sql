-- ============================================================================
-- ocg-inventory-app : merged lightweight dataset schema
--
-- This is the schema for the file the data pipeline BUILDS and the app SYNCS
-- (read-only from the app's point of view). It does not include user data
-- (inventory / decks / storage locations) -- see app-local-schema.sql for that.
-- ============================================================================

-- Canonical card master. One row per BabelCDB card code (datas.id == texts.id).
-- Columns mirror BabelCDB's `datas` table 1:1 (same bit-encodings as ocgcore-wasm /
-- yugioh-duel-engine/play.mjs's loadCards() / yuugiou's CardDatabase.kt.loadCards()),
-- so existing OcgType / OcgRace / OcgAttribute constants can decode these directly
-- without redefining them in this app.
CREATE TABLE cards (
  id                   INTEGER PRIMARY KEY,     -- BabelCDB card code
  alias                INTEGER NOT NULL DEFAULT 0, -- 0 = none; else canonical id this alt-art/errata card points to
  name_ja              TEXT NOT NULL,
  name_ja_normalized   TEXT NOT NULL,           -- kana-folded (hiragana->katakana), lowercased, for forgiving search
  desc_ja              TEXT NOT NULL DEFAULT '', -- full rules/flavor text (texts.desc -- NOT currently loaded by
                                                   -- play.mjs, but CardDatabase.kt's merge already carries it via SELECT *)
  desc_ja_normalized   TEXT NOT NULL DEFAULT '',
  card_type            INTEGER NOT NULL,        -- OcgType bitmask: monster/spell/trap/effect/fusion/synchro/xyz/link/pendulum/...
  race                 INTEGER NOT NULL DEFAULT 0, -- OcgRace bitmask: monster species, or spell/trap subtype
  attribute            INTEGER NOT NULL DEFAULT 0, -- OcgAttribute bitmask: LIGHT/DARK/EARTH/WATER/FIRE/WIND/DIVINE
  atk                  INTEGER NOT NULL DEFAULT 0,
  def                  INTEGER NOT NULL DEFAULT 0,
  level                INTEGER NOT NULL DEFAULT 0, -- level or rank
  lscale               INTEGER NOT NULL DEFAULT 0,
  rscale               INTEGER NOT NULL DEFAULT 0,
  link_marker          INTEGER NOT NULL DEFAULT 0,
  archetype_setcodes   TEXT NOT NULL DEFAULT '[]'  -- JSON array of BabelCDB setcode ints.
                                                     -- NOTE: this is BabelCDB's own "setcode" field, an archetype tag
                                                     -- (e.g. "Blue-Eyes"), NOT print/rarity info -- see card_prints below.
);

CREATE INDEX idx_cards_name_ja_normalized ON cards(name_ja_normalized);
CREATE INDEX idx_cards_attribute          ON cards(attribute);
CREATE INDEX idx_cards_race               ON cards(race);
CREATE INDEX idx_cards_card_type          ON cards(card_type);

-- Print appearances: which sets a card was released in, and at what rarity.
-- Sourced from Yugipedia's MediaWiki API (Set Card Lists pages, CC BY-SA),
-- since BabelCDB's setcode does not carry this information.
CREATE TABLE card_prints (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id       INTEGER NOT NULL REFERENCES cards(id),
  set_code      TEXT NOT NULL,   -- e.g. "SUB1-JP001"
  set_name      TEXT NOT NULL,   -- e.g. "覇王の魂"
  rarity        TEXT NOT NULL,   -- e.g. "スーパーレア" -- kept as free text; OCG rarity naming isn't a small
                                   -- fixed enum across product lines (structure decks, box sets, etc. all differ)
  release_date  TEXT              -- ISO 8601 (YYYY-MM-DD), nullable -- Yugipedia doesn't always have this cleanly
);

CREATE INDEX idx_card_prints_card_id ON card_prints(card_id);
-- Same set_code + card can legitimately appear more than once at different rarities (e.g.
-- a set sold in both a regular and a "Prismatic Secret Rare" extended-art printing under
-- the same print code) -- rarity is part of the row's identity, not incidental to it.
CREATE UNIQUE INDEX idx_card_prints_unique ON card_prints(set_code, card_id, rarity);

-- Perceptual (difference) hash of each card's official artwork thumbnail, for the
-- camera's イラストで識別 mode: photograph a card, hash the illustration the same way
-- client-side, and find the closest match(es) by Hamming distance -- no text OCR involved.
-- One row per card (not per print): reprints of the same card share the same artwork and
-- therefore the same hash, so this identifies the CARD, not the specific set/rarity (that
-- still comes from picking among card_prints afterward, same as name-OCR mode already
-- works). See data-pipeline/scripts/lib/dhash.mjs -- the app must compute its query hash
-- with the exact same algorithm (9x8 greyscale difference hash) for distances to be
-- comparable at all.
CREATE TABLE card_hashes (
  card_id  INTEGER PRIMARY KEY REFERENCES cards(id),
  dhash    TEXT NOT NULL   -- 64-bit hash as 16 lowercase hex chars
);

-- Pipeline/build bookkeeping, read by the app to decide whether a newer dataset
-- is available (drives the "新弾同期の通知" feature).
CREATE TABLE sync_meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
-- expected keys: dataset_version, built_at, babelcdb_commit, ja_source_commit, yugipedia_fetched_at
