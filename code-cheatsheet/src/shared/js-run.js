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
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('console', `"use strict";\n${code}`);
    await fn(con);
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : `Uncaught ${fmtArgs([e])}`;
  }
  return { out: lines.join('\n'), error };
}
