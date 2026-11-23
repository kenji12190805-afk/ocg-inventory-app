// Pyodide の実行に必要なファイルを public/pyodide にコピーする(オフラインで動かすため同梱する)
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pyodide');
const dst = join(root, 'public', 'pyodide');
const files = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];

if (!existsSync(src)) {
  console.error('node_modules/pyodide が見つかりません。先に npm install を実行してください。');
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
for (const f of files) cpSync(join(src, f), join(dst, f));
console.log(`pyodide: ${files.length} files -> public/pyodide`);
