// 例文を本物の処理系で実行して、出力を content/recorded.json に記録する。
//   Python: Pyodide(アプリと同じエンジン) / JavaScript: Node.js(V8) / C: gcc
// 正しい例文(code)が警告やエラーを出したら失敗にする(出力を記録する前に例文を直す)。
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPyodide } from 'pyodide';
import { parseTopic, LANGS } from '../src/shared/content.js';
import { runJs } from '../src/shared/js-run.js';
import { PY_WRAPPER, runPython } from '../src/shared/py-run.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = join(root, 'content');

export function loadTopics() {
  return readdirSync(contentDir)
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .map((f) => ({ file: f, ...parseTopic(readFileSync(join(contentDir, f), 'utf8')) }));
}

const SIGNALS = { SIGSEGV: 'Segmentation fault', SIGFPE: 'Floating point exception', SIGABRT: 'Aborted', SIGILL: 'Illegal instruction', SIGBUS: 'Bus error' };

export function runC(code, { quiet = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-'));
  try {
    writeFileSync(join(dir, 'main.c'), code + '\n');
    const env = { ...process.env, LC_ALL: 'C', LANG: 'C', GCC_COLORS: '' };
    const cc = spawnSync('gcc', ['-std=c11', '-Wall', '-Wextra', ...(quiet ? ['-Wno-unused-variable', '-Wno-unused-but-set-variable'] : []), '-fdiagnostics-color=never', '-o', 'main', 'main.c', '-lm'], { cwd: dir, env, encoding: 'utf8' });
    const compileMsg = (cc.stderr || '').trim();
    if (cc.status !== 0) return { text: compileMsg, failed: true, warnings: compileMsg };
    const run = spawnSync('./main', [], { cwd: dir, env, encoding: 'utf8', timeout: 5000 });
    let text = compileMsg ? compileMsg + '\n' : '';
    text += run.stdout || '';
    if (text && !text.endsWith('\n')) text += '\n';
    let failed = false;
    if (run.signal) {
      text += SIGNALS[run.signal] ?? `Terminated by ${run.signal}`;
      failed = true;
    } else if (run.status !== 0) {
      text += `(exit code ${run.status})`;
      failed = true;
    }
    return { text: text.replace(/\n+$/, ''), failed, warnings: compileMsg };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const topics = loadTopics();
  const pyodide = await loadPyodide();
  pyodide.runPython(PY_WRAPPER);
  const problems = [];
  const recorded = {};
  for (const t of topics) {
    recorded[t.id] = {};
    for (const lang of ['python', 'javascript', 'c']) {
      const v = t.variants[lang];
      if (!v) continue;
      const exec = async (code, isBug = false) => {
        if (lang === 'python') {
          const r = runPython(pyodide, code);
          return { text: [r.out, r.error].filter(Boolean).join('\n'), failed: !!r.error };
        }
        if (lang === 'javascript') {
          const r = await runJs(code);
          return { text: [r.out, r.error].filter(Boolean).join('\n'), failed: !!r.error };
        }
        return runC(code, { quiet: isBug });
      };
      const good = await exec(v.code);
      if (good.failed || good.warnings) problems.push(`${t.id}/${lang}: 正しい例文なのにエラーか警告が出ました\n${good.text}`);
      const bug = v.bugCode !== undefined ? await exec(v.bugCode, true) : undefined;
      if (v.bugCode !== undefined && bug && !bug.failed && !t.why?.[lang]) problems.push(`${t.id}/${lang}: bug の説明(why)がありません`);
      recorded[t.id][lang] = { out: good.text, bug: bug ? { text: bug.text, failed: bug.failed } : undefined };
    }
  }
  writeFileSync(join(root, 'content', 'recorded.json'), JSON.stringify(recorded, null, 1) + '\n');
  if (problems.length) {
    console.error(problems.join('\n\n'));
    process.exit(1);
  }
  console.log(`recorded ${topics.length} topics`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
