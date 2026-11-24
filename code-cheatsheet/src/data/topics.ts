import { parseTopic } from '../shared/content.js';
import type { Lang } from '../runners/types';
import recorded from '../../content/recorded.json';
import picocOk from '../../content/picoc.json';

export interface Outcome {
  text: string;
  failed: boolean;
}
export interface Variant {
  code: string;
  bugCode?: string;
  note?: string;
  /** エラーになる例の説明 */
  why?: string;
  /** 記録された結果(Python/JS/Cは本物の処理系で実行、Kotlinは目安) */
  out: Outcome;
  bugOut?: Outcome;
}
export interface Topic {
  id: string;
  category: string;
  title: string;
  summary: string;
  keywords: string[];
  variants: Partial<Record<Lang, Variant>>;
  /** スマホ内のCエンジン(picoc)の結果がgccと一致するか */
  picocMatches: boolean;
  /** レシピ(部品を組み合わせて作るミニプログラム)か、ふつうの部品か */
  kind: 'topic' | 'recipe';
  /** レシピが使っている部品(トピックの id) */
  uses: string[];
}

export const LANG_ORDER: Lang[] = ['python', 'javascript', 'c', 'kotlin'];
export const LANG_LABEL: Record<Lang, string> = { python: 'Python', javascript: 'JavaScript', c: 'C', kotlin: 'Kotlin' };
export const LANG_ENGINE: Record<Lang, string> = {
  python: 'Python 3.14(Pyodide)で実行',
  javascript: 'JavaScript(V8)で実行',
  c: 'gcc でコンパイルして実行',
  kotlin: 'Kotlin 2.x の出力(目安)',
};

type RecordedFile = Record<string, Partial<Record<Lang, { out: string; bug?: Outcome }>>>;
const rec = recorded as RecordedFile;
const picoc = picocOk as Record<string, boolean>;
const files = import.meta.glob('../../content/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const looksFailed = (t: string) => /(^|\n)main\.kt:\d+:\d+: error|Exception in thread|Error:/.test(t);

function build(): Topic[] {
  const topics: Topic[] = [];
  for (const [path, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const t = parseTopic(text);
    const variants: Topic['variants'] = {};
    for (const lang of LANG_ORDER) {
      const v = t.variants[lang];
      if (!v) continue;
      const r = rec[t.id]?.[lang];
      if (lang === 'kotlin') {
        variants[lang] = {
          code: v.code,
          bugCode: v.bugCode,
          note: v.note,
          why: v.why,
          out: { text: v.out ?? '', failed: false },
          bugOut: v.bugOut !== undefined ? { text: v.bugOut, failed: looksFailed(v.bugOut) } : undefined,
        };
      } else if (r) {
        variants[lang] = { code: v.code, bugCode: v.bugCode, note: v.note, why: v.why, out: { text: r.out, failed: false }, bugOut: r.bug };
      } else {
        throw new Error(`${path}: ${lang} の記録がありません。npm run record を実行してください`);
      }
    }
    topics.push({ id: t.id, category: t.category, title: t.title, summary: t.summary, keywords: t.keywords ?? [], variants, picocMatches: picoc[t.id] !== false, kind: t.kind === 'recipe' ? 'recipe' : 'topic', uses: t.uses ?? [] });
  }
  return topics;
}

export const TOPICS: Topic[] = build();
export const topicById = (id: string) => TOPICS.find((t) => t.id === id);
export const CATEGORIES = [...new Set(TOPICS.map((t) => t.category))];

/** この部品を使っているレシピ(「組み合わせて作れるもの」) */
export const recipesUsing = (id: string) => TOPICS.filter((t) => t.kind === 'recipe' && t.uses.includes(id));
export const RECIPE_CATEGORY = '作ってみよう';
