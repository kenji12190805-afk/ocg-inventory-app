import { runJs } from '../shared/js-run.js';

self.onmessage = async (e: MessageEvent<{ code: string }>) => {
  const r = await runJs(e.data.code);
  (self as unknown as Worker).postMessage({ text: [r.out, r.error].filter(Boolean).join('\n'), failed: !!r.error });
};
