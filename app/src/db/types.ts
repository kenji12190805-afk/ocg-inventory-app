// Mirrors data-pipeline/schema.sql (synced dataset) and app-local-schema.sql (local data).

export interface Card {
  id: number;
  alias: number;
  name_ja: string;
  desc_ja: string;
  card_type: number;
  race: number;
  attribute: number;
  atk: number;
  def: number;
  level: number;
  lscale: number;
  rscale: number;
  link_marker: number;
  archetype_setcodes: number[];
}

export interface CardPrint {
  id: number;
  card_id: number;
  set_code: string;
  set_name: string;
  rarity: string;
  release_date: string | null;
}

export interface StorageLocation {
  id: number;
  name: string;
  sort_order: number;
}

export interface InventoryRow {
  id: number;
  print_id: number;
  quantity: number;
  storage_location_id: number | null;
  note: string;
  updated_at: string;
}

export interface Deck {
  id: number;
  name: string;
  created_at: string;
}

export interface DeckCard {
  deck_id: number;
  card_id: number;
  quantity: number;
}

// Overseas (English TCG) reference price -- see schema.sql's card_prices comment for why
// this is not the Japanese OCG market price.
export interface CardPrice {
  card_id: number;
  cardmarket_eur: number | null;
  tcgplayer_usd: number | null;
  ebay_usd: number | null;
  amazon_usd: number | null;
  coolstuffinc_usd: number | null;
  fetched_at: string;
}

export interface PriceLogEntry {
  id: number;
  print_id: number;
  price_jpy: number;
  source: string;
  note: string;
  observed_at: string;
}

export interface SyncMeta {
  dataset_version?: string;
  built_at?: string;
  babelcdb_commit?: string;
  ja_source_commit?: string;
  yugipedia_fetched_at?: string;
}
