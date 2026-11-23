import { runC } from 'picoc-js';

/**
 * picoc のエラー表示を整える。
 *  - 構文・名前のエラーは「file.c:行:桁 メッセージ」の形で標準出力に出る → main.c に直してエラー扱いにする
 *  - 実行時エラー(0で割るなど)は WebAssembly の例外として出る → 1行にまとめる
 */
function tidy(lines: string[]): { text: string; failed: boolean } {
  let failed = false;
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s+at .*wasm/.test(line)) continue; // WebAssembly のスタックトレースは読めないので捨てる
    const ex = /^exception thrown: (?:RuntimeError: )?([^,\n]*)/.exec(line);
    if (ex) {
      failed = true;
      if (!out.some((l) => l.startsWith('runtime error:'))) out.push(`runtime error: ${ex[1]}`);
      continue;
    }
    if (/(^|\n)file\.c:\d+:\d+ /.test(line)) failed = true;
    out.push(line.replace(/file\.c:/g, 'main.c:'));
  }
  // 実行時エラーの1行にまとまっているときは、エンジンの重複メッセージを消す
  const text = out.some((l) => l.startsWith('runtime error:')) ? out.filter((l) => !l.startsWith('(実行エンジンのエラー)')) : out;
  return { text: text.join('\n'), failed };
}

// picoc はエラーを console.warn(標準エラー)に出すこともあるので、ここで拾う
self.onmessage = (e: MessageEvent<{ code: string }>) => {
  const lines: string[] = [];
  let sawStderr = false;
  const origWarn = console.warn;
  const origError = console.error;
  const capture = (...a: unknown[]) => {
    sawStderr = true;
    lines.push(a.map(String).join(' '));
  };
  console.warn = capture;
  console.error = capture;
  const post = (extraFail: boolean) => {
    console.warn = origWarn;
    console.error = origError;
    const t = tidy(lines);
    (self as unknown as Worker).postMessage({ text: t.text, failed: t.failed || sawStderr || extraFail });
  };
  try {
    runC(
      e.data.code,
      (s: string) => lines.push(s),
      (err: unknown) => {
        if (err && !(err as { name?: string }).name?.includes('ExitStatus')) {
          lines.push(`(実行エンジンのエラー) ${String((err as Error).message ?? err)}`);
          post(true);
        } else {
          post(false);
        }
      },
    );
  } catch (err) {
    lines.push(`(実行エンジンのエラー) ${String((err as Error).message ?? err)}`);
    post(true);
  }
};
