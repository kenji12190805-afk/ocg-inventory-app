import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import { LOCAL_SCHEMA_SQL } from './localSchema';

// Where the pipeline publishes the merged, read-only card dataset (see
// data-pipeline/.github/workflows/build-dataset.yml). Named "dataset" (bare, no
// extension) since @capacitor-community/sqlite's getFromHTTPRequest derives the stored
// db's name from the URL's basename.
const DATASET_URL =
  'https://github.com/kenji12190805-afk/ocg-inventory-app/releases/download/dataset-latest/dataset.db';
const DATASET_DB_NAME = 'dataset';
const LOCAL_DB_NAME = 'ocg_local';

const sqlite = new SQLiteConnection(CapacitorSQLite);

let webStoreReady: Promise<void> | null = null;

function ensureWebStoreReady(): Promise<void> {
  if (Capacitor.getPlatform() !== 'web') return Promise.resolve();
  if (!webStoreReady) {
    webStoreReady = (async () => {
      await customElements.whenDefined('jeep-sqlite');
      await sqlite.initWebStore();
    })();
  }
  return webStoreReady;
}

let datasetConn: SQLiteDBConnection | null = null;
let localConn: SQLiteDBConnection | null = null;

/**
 * Opens (downloading if needed) the read-only synced card dataset. Call once at app
 * startup; safe to call again later to force a re-download (e.g. from the sync/settings
 * screen) by passing forceRedownload.
 */
export async function openDataset(forceRedownload = false): Promise<SQLiteDBConnection> {
  await ensureWebStoreReady();

  if (datasetConn && !forceRedownload) return datasetConn;
  if (datasetConn) {
    await sqlite.closeConnection(DATASET_DB_NAME, true);
    datasetConn = null;
  }

  const exists = forceRedownload ? false : (await sqlite.isDatabase(DATASET_DB_NAME)).result;
  if (!exists) {
    await sqlite.getFromHTTPRequest(DATASET_URL, true);
  }

  const conn = await sqlite.createConnection(DATASET_DB_NAME, false, 'no-encryption', 1, true);
  await conn.open();
  datasetConn = conn;
  return conn;
}

/** Opens (creating on first run) the app-local database: inventory, decks, storage locations. */
export async function openLocalDb(): Promise<SQLiteDBConnection> {
  await ensureWebStoreReady();
  if (localConn) return localConn;

  const conn = await sqlite.createConnection(LOCAL_DB_NAME, false, 'no-encryption', 1, false);
  await conn.open();
  await conn.execute(LOCAL_SCHEMA_SQL);
  localConn = conn;
  return conn;
}

export function getDatasetUrl(): string {
  return DATASET_URL;
}

// Small companion file (see data-pipeline/scripts/04-build-dataset.mjs) the app polls
// cheaply to check for a newer dataset without re-downloading the whole ~20MB dataset.db.
const META_URL =
  'https://github.com/kenji12190805-afk/ocg-inventory-app/releases/download/dataset-latest/meta.json';

export function getMetaUrl(): string {
  return META_URL;
}

// Diff of the last sync vs. the one before it (see data-pipeline/scripts/05-generate-
// changelog.mjs) -- what the "新着カード" screen shows.
const CHANGELOG_URL =
  'https://github.com/kenji12190805-afk/ocg-inventory-app/releases/download/dataset-latest/changelog.json';

export function getChangelogUrl(): string {
  return CHANGELOG_URL;
}
