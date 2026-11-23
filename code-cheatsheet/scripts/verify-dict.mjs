// 補完の辞書の品質チェック: ひな形を初期値で埋めて、Python/JavaScript/C は本当に文法が通るか確かめる
// (一時ファイルは OS の一時フォルダに作る。このスクリプトは何も削除しない)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DICT, expandDefault } from '../src/dict/index.ts';
import { checkJs } from '../src/shared/js-run.js';

const indent = (s, n = 4) => s.split('\n').map((l) => ' '.repeat(n) + l).join('\n');
let bad = 0;
const fail = (lang, e, msg) => {
  bad++;
  console.error(`NG ${lang} "${e.l}": ${msg}`);
};

for (const [lang, list] of Object.entries(DICT)) {
  const labels = new Set();
  for (const e of list) {
    if (!e.l || !e.t || !e.m) fail(lang, e, 'l / t / m のどれかが空です');
    if (labels.has(e.l)) fail(lang, e, 'ラベルが重複しています');
    labels.add(e.l);
    if (!e.raw && /\$\{[^}]*\$\{/.test(e.t)) fail(lang, e, '穴の記法(${…})が入れ子になっています');
  }
}

// ---- Python ----
{
  const cases = DICT.python.map((e) => {
    const code = expandDefault(e.t, e.raw);
    const body = e.ctx === 'loop' ? `while True:\n${indent(code)}\n` : e.ctx === 'func' ? `def _f():\n${indent(code)}\n` : code + '\n';
    return (e.pre ?? '') + body;
  });
  const py = [
    'import sys, json',
    'cases = json.load(sys.stdin)',
    'out = []',
    'for i, src in enumerate(cases):',
    '    try:',
    '        compile(src, "x.py", "exec")',
    '    except SyntaxError as ex:',
    '        out.append([i, str(ex)])',
    'print(json.dumps(out))',
  ].join('\n');
  const r = spawnSync('python3', ['-c', py], { input: JSON.stringify(cases), encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stderr);
    process.exit(1);
  }
  for (const [i, msg] of JSON.parse(r.stdout)) fail('python', DICT.python[i], msg);
}

// ---- JavaScript ----
for (const e of DICT.javascript) {
  const code = expandDefault(e.t, e.raw);
  const body = e.ctx === 'loop' ? `for (;;) {\n${code}\n}` : e.ctx === 'func' ? `function _f() {\n${code}\n}` : code;
  const r = checkJs((e.pre ?? '') + body);
  if (!r.ok) fail('javascript', e, r.error);
}

// ---- C ----
{
  const dir = mkdtempSync(join(tmpdir(), 'dict-'));
  const prelude = '#include <stdio.h>\n#include <string.h>\n#include <stdlib.h>\n#include <ctype.h>\n';
  const locals =
    'int x = 1, n = 1, a = 1, b = 1, age = 30, day = 1, has_ticket = 1, count = 0; double d = 1.5; char s[64] = "Hello"; char dest[64] = ""; char name[32] = "Kenji"; int scores[3] = {1, 2, 3}; int *p = &n; int ages[3] = {1, 2, 3};\n';
  for (const e of DICT.c) {
    let code = expandDefault(e.t, e.raw);
    // strlen(s) のような「式」の項目は、文として確かめるために ; を足す
    if (!e.top && !/[;}]\s*$/.test(code)) code += ';';
    let src;
    if (e.top) {
      const hasMain = /\bint main\s*\(/.test(code);
      src = prelude + code + '\n' + (hasMain ? '' : 'int main(void) { return 0; }\n');
    } else {
      const inner = e.ctx === 'loop' ? `for (;;) {\n${code}\n}` : code;
      src = prelude + `int main(void) {\n${locals}{\n${e.pre ?? ''}${inner}\n}\nreturn 0;\n}\n`;
    }
    writeFileSync(join(dir, 'x.c'), src);
    const r = spawnSync('gcc', ['-std=c11', '-fsyntax-only', '-w', 'x.c'], { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) fail('c', e, (r.stderr || '').split('\n').filter((l) => /error/.test(l)).slice(0, 2).join(' / '));
  }
}

const total = Object.values(DICT).reduce((n, l) => n + l.length, 0);
console.log(`dict: ${total} entries (${Object.entries(DICT).map(([k, v]) => `${k} ${v.length}`).join(', ')}); Kotlin は文法を機械では確かめていません`);
if (bad) {
  console.error(`${bad} 件の問題があります`);
  process.exit(1);
}
console.log('verify-dict: all good');
