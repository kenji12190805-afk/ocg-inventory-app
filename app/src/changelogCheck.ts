import { CapacitorHttp } from '@capacitor/core';
import { getChangelogUrl } from './db/sqlite';

export interface ChangelogCard {
  id: number;
  nameJa: string;
  cardType: number;
}

export interface ChangelogSet {
  setName: string;
  cardCount: number;
}

export interface Changelog {
  builtAt: string | null;
  previousBuiltAt: string | null;
  newCardCount: number;
  newCards: ChangelogCard[];
  newSets: ChangelogSet[];
}

/** Fetches the diff of the last sync vs. the one before it (see data-pipeline/scripts/05-
 *  generate-changelog.mjs). Uses CapacitorHttp, not fetch() -- same CORS reason as
 *  updateCheck.ts's checkForDatasetUpdate. */
export async function fetchChangelog(): Promise<Changelog> {
  const res = await CapacitorHttp.get({ url: getChangelogUrl() });
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  return (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as Changelog;
}
