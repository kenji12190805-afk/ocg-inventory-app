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

export interface SyncMeta {
  dataset_version?: string;
  built_at?: string;
  babelcdb_commit?: string;
  ja_source_commit?: string;
  yugipedia_fetched_at?: string;
}
