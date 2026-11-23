import type { Lang, RunResult } from './types';
import { runKotlin } from './kotlin';

export type { Lang, RunResult } from './types';

const TIMEOUT_MS = 8000;
const TIMEOUT_TEXT = '8秒たっても終わらなかったので止めました。無限ループになっていないか確認してね。';

/** 使い捨てWorkerでコードを実行する(終わらなければ強制終了) */
function oneShot(make: () => Worker, code: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const w = make();
    const finish = (r: { text: string; failed: boolean }) => {
      clearTimeout(timer);
      w.terminate();
      resolve({ ...r, text: r.text || '(出力なし)', ms: performance.now() - t0 });
    };
    const timer = setTimeout(() => finish({ text: TIMEOUT_TEXT, failed: true }), TIMEOUT_MS);
    w.onmessage = (e) => finish(e.data);
    w.onerror = (e) => finish({ text: `(実行エンジンのエラー) ${e.message}`, failed: true });
    w.postMessage({ code });
  });
}

// ---- Python: 読み込みが重いので1つのWorkerを使い回す ----
let pyWorker: Worker | null = null;
let pyReady: Promise<void> | null = null;
export type PyStatus = 'idle' | 'loading' | 'ready';
let pyStatus: PyStatus = 'idle';
const listeners = new Set<(s: PyStatus) => void>();
export const onPythonStatus = (fn: (s: PyStatus) => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const setPy = (s: PyStatus) => {
  pyStatus = s;
  listeners.forEach((f) => f(s));
};
export const getPythonStatus = () => pyStatus;

function resetPython() {
  pyWorker?.terminate();
  pyWorker = null;
  pyReady = null;
  setPy('idle');
}

/** Pyodide を先に読み込んでおく(Pythonの例文を開いたときに呼ぶ) */
export function preloadPython(): Promise<void> {
  if (pyReady) return pyReady;
  setPy('loading');
  const w = new Worker(new URL('./py.worker.ts', import.meta.url), { type: 'module' });
  pyWorker = w;
  pyReady = new Promise<void>((resolve, reject) => {
    w.onmessage = (e) => {
      if (e.data.type === 'ready') {
        setPy('ready');
        resolve();
      } else if (e.data.fatal) {
        reject(new Error(e.data.text));
      }
    };
    w.onerror = (e) => reject(new Error(e.message));
    const indexURL = new URL('pyodide/', document.baseURI).href;
    // 公開ページなど .zip を置けない場所用: 標準ライブラリのファイル名を差し替えられる
    const stdName = import.meta.env.VITE_PY_STDLIB as string | undefined;
    w.postMessage({ type: 'init', indexURL, stdLibURL: stdName ? indexURL + stdName : undefined });
  });
  pyReady.catch(() => resetPython());
  return pyReady;
}

async function runPython(code: string): Promise<RunResult> {
  const t0 = performance.now();
  try {
    await preloadPython();
  } catch (e) {
    return { text: `Python の準備に失敗しました: ${(e as Error).message}`, failed: true, ms: performance.now() - t0 };
  }
  const w = pyWorker!;
  const t1 = performance.now();
  return new Promise<RunResult>((resolve) => {
    const timer = setTimeout(() => {
      resetPython();
      resolve({ text: TIMEOUT_TEXT + '\n(Python を作り直します。次の実行は少し時間がかかります)', failed: true, ms: performance.now() - t1 });
    }, TIMEOUT_MS);
    w.onmessage = (e) => {
      if (e.data.type !== 'result') return;
      clearTimeout(timer);
      resolve({ text: e.data.text || '(出力なし)', failed: e.data.failed, ms: performance.now() - t1 });
    };
    w.postMessage({ type: 'run', code });
  });
}

export function run(lang: Lang, code: string): Promise<RunResult> {
  switch (lang) {
    case 'python':
      return runPython(code);
    case 'javascript':
      return oneShot(() => new Worker(new URL('./js.worker.ts', import.meta.url), { type: 'module' }), code);
    case 'c':
      return oneShot(() => new Worker(new URL('./c.worker.ts', import.meta.url), { type: 'module' }), code);
    case 'kotlin':
      return runKotlin(code);
  }
}
