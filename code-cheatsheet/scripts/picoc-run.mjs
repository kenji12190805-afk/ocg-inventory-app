// picoc(アプリ内でCを動かすエンジン)をNodeで1回だけ実行する。標準入力のCコードを実行して標準出力に出す。
// picoc はエラーのとき Node プロセスごと終了するので、1コード=1プロセスで呼び出す。
import { runC } from 'picoc-js';
let code = '';
for await (const chunk of process.stdin) code += chunk;
const lines = [];
runC(code, (s) => lines.push(s));
setTimeout(() => {
  process.stdout.write(lines.join('\n'));
  process.exit(0);
}, 1500);
