import { runJs, checkJs } from '../shared/js-run.js';

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<{ code: string; mode?: 'run' | 'check' }>) => {
  if (e.data.mode === 'check') {
    const r = checkJs(e.data.code);
    post({ text: r.ok ? '文法エラーは見つかりませんでした(実行はしていません)' : r.error, failed: !r.ok });
    return;
  }
  const r = await runJs(e.data.code);
  post({ text: [r.out, r.error].filter(Boolean).join('\n'), failed: !!r.error, line: r.line });
};
