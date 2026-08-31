import { CapacitorHttp } from '@capacitor/core';
import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { getSyncMeta } from './db/datasetRepo';
import { getMetaUrl } from './db/sqlite';

export interface UpdateCheckResult {
  available: boolean;
  remoteBuiltAt: string | null;
}

/** Compares the locally-synced dataset's built_at against the remote meta.json (a tiny
 *  file, not the ~20MB dataset itself). Uses CapacitorHttp (native request) rather than
 *  fetch() -- GitHub's release-asset URLs don't send Access-Control-Allow-Origin, so a
 *  plain browser fetch() gets blocked by CORS even though the request itself would
 *  succeed. Network failures are treated as "no update" -- this is a best-effort
 *  convenience check, not something that should surface as an error every time the user
 *  is offline. */
export async function checkForDatasetUpdate(dataset: SQLiteDBConnection): Promise<UpdateCheckResult> {
  try {
    const [local, res] = await Promise.all([
      getSyncMeta(dataset),
      CapacitorHttp.get({ url: getMetaUrl() }),
    ]);
    if (res.status < 200 || res.status >= 300) return { available: false, remoteBuiltAt: null };
    const remote = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as { built_at?: string };
    if (!remote.built_at) return { available: false, remoteBuiltAt: null };
    return {
      available: remote.built_at !== local.built_at,
      remoteBuiltAt: remote.built_at,
    };
  } catch {
    return { available: false, remoteBuiltAt: null };
  }
}
