// Shared network helper for the pipeline's Yugipedia calls.
//
// Why this exists: a single transient failure (HTTP 429/5xx, a dropped connection, or an
// HTML error page where JSON was expected) used to abort a whole weekly run -- the
// 2026-11-01 run died in "Fetch Yugipedia fallback cards" that way and no new set shipped.
// Retrying with backoff turns those into non-events; only a *persistent* failure aborts
// (which is still the right outcome: publishing a degraded dataset is worse than keeping
// last week's good one live).
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * GET `url` and parse the body as JSON, retrying transient failures.
 * @param {string | URL} url
 * @param {{ headers?: Record<string,string>, attempts?: number, baseDelayMs?: number }} [opts]
 */
export async function getJsonWithRetry(url, opts = {}) {
  const { headers = {}, attempts = 6, baseDelayMs = 1500 } = opts;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} for ${url}`);
        err.retryable = RETRYABLE_STATUS.has(res.status);
        // Honor Retry-After when the server provides one (seconds).
        const retryAfter = Number(res.headers.get("retry-after"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) err.retryAfterMs = retryAfter * 1000;
        throw err;
      }
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        // Gateways sometimes answer 200 with an HTML error page; treat as transient.
        const err = new Error(`non-JSON response (${text.slice(0, 80).replace(/\s+/g, " ")}) for ${url}`);
        err.retryable = true;
        throw err;
      }
    } catch (err) {
      lastError = err;
      // fetch() itself throws TypeError on network errors -- those are retryable too.
      const retryable = err.retryable ?? err instanceof TypeError;
      if (!retryable || attempt === attempts) break;
      const delay = err.retryAfterMs ?? baseDelayMs * 2 ** (attempt - 1);
      console.warn(`  retry ${attempt}/${attempts - 1} in ${Math.round(delay)}ms: ${err.message}`);
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Download `url` to `destPath` (binary-safe), retrying transient failures.
 * Resolves `{ status: 200 }` on success, `{ status: 404 }` if the file doesn't exist
 * (callers decide whether that's fatal); any other persistent failure throws.
 */
export async function downloadWithRetry(url, destPath, opts = {}) {
  const { writeFileSync } = await import("node:fs");
  const { attempts = 6, baseDelayMs = 2000 } = opts;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return { status: 404 };
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} for ${url}`);
        err.retryable = RETRYABLE_STATUS.has(res.status);
        throw err;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw Object.assign(new Error(`empty body for ${url}`), { retryable: true });
      writeFileSync(destPath, buf);
      return { status: 200, bytes: buf.length };
    } catch (err) {
      lastError = err;
      const retryable = err.retryable ?? err instanceof TypeError;
      if (!retryable || attempt === attempts) break;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.warn(`  download retry ${attempt}/${attempts - 1} in ${delay}ms: ${err.message}`);
      await sleep(delay);
    }
  }
  throw lastError;
}
