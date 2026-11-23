import type { RunResult } from './types';

/**
 * Kotlin は端末内では動かせないので、公式 Kotlin Playground の API にコードを送って実行する(ネット接続が必要)。
 * 送るのは、画面で編集したコードだけ。
 */
const API_BASE = 'https://api.kotlinlang.org/api';
// 使えるバージョンのパスを順番に試す(古いものが止まっても動くように)
const VERSIONS = ['latest', '2.2.20', '2.1.0', '2.0.0'];
let workingVersion: string | null = null;

interface PlaygroundResponse {
  errors?: Record<string, { message: string; severity: string; interval?: { start: { line: number; ch: number } } }[]>;
  exception?: { fullName?: string; message?: string; stackTrace?: { className?: string; methodName?: string; fileName?: string; lineNumber?: number }[] } | null;
  text?: string;
}

const unescapeHtml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function streamText(html: string, tag: 'outStream' | 'errStream'): string {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  let out = '';
  for (const m of html.matchAll(re)) out += unescapeHtml(m[1]);
  return out;
}

export function formatPlaygroundResponse(res: PlaygroundResponse): { text: string; failed: boolean } {
  const lines: string[] = [];
  let failed = false;
  for (const list of Object.values(res.errors ?? {})) {
    for (const d of list) {
      if (d.severity === 'ERROR') failed = true;
      const pos = d.interval ? `main.kt:${d.interval.start.line + 1}:${d.interval.start.ch + 1}: ` : '';
      lines.push(`${pos}${d.severity.toLowerCase()}: ${d.message}`);
    }
  }
  const html = res.text ?? '';
  const out = streamText(html, 'outStream');
  const err = streamText(html, 'errStream');
  let text = lines.join('\n');
  if (out) text += (text ? '\n' : '') + out.replace(/\n$/, '');
  if (err) text += (text ? '\n' : '') + err.replace(/\n$/, '');
  if (res.exception) {
    failed = true;
    const ex = res.exception;
    text += (text ? '\n' : '') + `Exception in thread "main" ${ex.fullName ?? ''}${ex.message ? `: ${ex.message}` : ''}`;
    for (const f of (ex.stackTrace ?? []).slice(0, 3)) text += `\n\tat ${f.className ?? ''}.${f.methodName ?? ''}(${f.fileName ?? ''}:${f.lineNumber ?? ''})`;
  }
  if (err && !failed) failed = true;
  return { text, failed };
}

export async function runKotlin(code: string): Promise<RunResult> {
  const t0 = performance.now();
  const body = JSON.stringify({ args: '', files: [{ name: 'File.kt', text: code, publicId: '' }], confType: 'java' });
  const candidates = workingVersion ? [workingVersion] : VERSIONS;
  let lastError = '';
  for (const v of candidates) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch(`${API_BASE}/${v}/compiler/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) {
        lastError = `HTTP ${r.status}`;
        continue;
      }
      const json = (await r.json()) as PlaygroundResponse;
      workingVersion = v;
      const f = formatPlaygroundResponse(json);
      return { ...f, text: f.text || '(出力なし)', ms: performance.now() - t0 };
    } catch (e) {
      lastError = (e as Error).name === 'AbortError' ? '20秒たっても返事がありませんでした' : String((e as Error).message ?? e);
    }
  }
  return { text: `Kotlin の実行サーバーにつながりませんでした(${lastError})。\nネット接続を確かめて、もう一度試してね。`, failed: true, ms: performance.now() - t0 };
}
