import { fmtArgs } from './format.js';

/**
 * JavaScript を実行して { out, error } を返す。ブラウザのWorkerとNodeの記録スクリプトで共通。
 * 画面に出すのは console.log 等の出力と、未処理エラーの "名前: メッセージ" だけ。
 */
export async function runJs(code) {
  const lines = [];
  const push = (...a) => lines.push(fmtArgs(a));
  const con = { log: push, info: push, debug: push, warn: push, error: push };
  let error = null;
  let line;
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('console', `"use strict";\n${code}`);
    await fn(con);
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : `Uncaught ${fmtArgs([e])}`;
    line = lineFromStack(e);
  }
  return { out: lines.join('\n'), error, line };
}

// new AsyncFunction で作った関数のスタックは、先頭に3行(関数の頭 + "use strict")が足されている
const HEADER_LINES = 3;
function lineFromStack(e) {
  const m = e instanceof Error && typeof e.stack === 'string' ? /<anonymous>:(\d+):\d+/.exec(e.stack) : null;
  const n = m ? Number(m[1]) - HEADER_LINES : NaN;
  return n > 0 ? n : undefined;
}

/** 実行せずに、文法だけを調べる */
export function checkJs(code) {
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    new AsyncFunction('console', `"use strict";\n${code}`);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}
