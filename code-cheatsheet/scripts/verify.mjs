// 例文の品質チェック:
//  1. content/recorded.json が最新か(例文を直したのに記録を更新し忘れていないか)
//  2. アプリ内のC実行エンジン(picoc)の結果が gcc の結果と一致するか
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTopics } from './record.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const recorded = JSON.parse(readFileSync(join(root, 'content', 'recorded.json'), 'utf8'));
const topics = loadTopics();
let bad = 0;
const picoc = {};

for (const t of topics) {
  const v = t.variants.c;
  if (!v) continue;
  if (t.picoc === false) {
    // メタ情報で「スマホ内の簡易Cエンジンでは動かない」と宣言されている例(関数ポインタなど)
    picoc[t.id] = false;
    console.log(`skip picoc ${t.id} (meta: picoc=false)`);
    continue;
  }
  const rec = recorded[t.id]?.c;
  if (!rec) {
    console.error(`NG ${t.id}: recorded.json にありません。npm run record を実行してください`);
    bad++;
    continue;
  }
  const r = spawnSync('node', [join(root, 'scripts', 'picoc-run.mjs')], { input: v.code, encoding: 'utf8', timeout: 20000, cwd: root });
  const got = (r.stdout || '').replace(/\s+$/, '');
  const want = rec.out.replace(/\s+$/, '');
  const ok = got === want;
  picoc[t.id] = ok;
  if (!ok) {
    console.error(`NG picoc ${t.id}\n  gcc  : ${JSON.stringify(want)}\n  picoc: ${JSON.stringify(got)}`);
    bad++;
  } else {
    console.log(`ok picoc ${t.id}`);
  }
}
writeFileSync(join(root, 'content', 'picoc.json'), JSON.stringify(picoc, null, 1) + '\n');
if (bad) process.exit(1);
console.log('verify: all good');
