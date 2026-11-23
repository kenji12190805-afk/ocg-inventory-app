import { PY_WRAPPER, runPython } from '../shared/py-run.js';

let pyodide: any = null;

self.onmessage = async (e: MessageEvent<{ type: 'init'; indexURL: string } | { type: 'run'; code: string }>) => {
  const post = (m: unknown) => (self as unknown as Worker).postMessage(m);
  const m = e.data;
  try {
    if (m.type === 'init') {
      const mod = await import(/* @vite-ignore */ `${m.indexURL}pyodide.mjs`);
      pyodide = await mod.loadPyodide({ indexURL: m.indexURL });
      pyodide.runPython(PY_WRAPPER);
      // input() はキーボード入力待ちにならず、すぐ EOFError にする
      pyodide.setStdin({ stdin: () => null });
      post({ type: 'ready' });
    } else if (m.type === 'run') {
      const r = runPython(pyodide, m.code);
      post({ type: 'result', text: [r.out, r.error].filter(Boolean).join('\n'), failed: !!r.error });
    }
  } catch (err) {
    post({ type: 'result', text: `(実行エンジンのエラー) ${String((err as Error).message ?? err)}`, failed: true, fatal: true });
  }
};
