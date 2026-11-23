import type { Lang } from './runners/types';
import type { Topic } from './data/topics';
import { TOPICS } from './data/topics';

/** 全角半角・大文字小文字・カタカナ/ひらがなのゆれをなくす */
export function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s　]+/g, ' ')
    .trim();
}

const LANG_ALIASES: Record<Lang, string[]> = {
  python: ['python', 'ぱいそん', 'py'],
  javascript: ['javascript', 'js', 'じゃばすくりぷと', 'node'],
  c: ['c', 'c言語', 'しーげんご'],
  kotlin: ['kotlin', 'kt', 'ことりん'],
};

/** 同じ意味の言葉(どれで検索しても、仲間の言葉でも当たる) */
const SYNONYM_GROUPS = [
  ['繰り返し', 'くりかえし', 'くり返し', '繰返し', '繰り返す', 'くりかえす', 'ループ', 'loop', '反復', 'イテレーション'],
  ['リスト', '配列', 'array', 'list', 'アレイ'],
  ['辞書', 'dict', 'dictionary', 'map', '連想配列', 'ハッシュ'],
  ['文字列', 'string', 'str', '文字'],
  ['関数', 'function', 'def', 'fun', 'func', 'メソッド'],
  ['例外', 'エラー処理', 'exception', 'try', 'catch', 'except', 'finally'],
  ['エラー', 'error', '失敗', '落ちる'],
  ['条件', '分岐', 'if', 'else', '条件分岐'],
  ['並べ替え', 'ソート', 'sort', '整列', '昇順', '降順'],
  ['null', 'ヌル', 'none', 'nil', 'undefined', '値がない', 'ぬるぽ'],
  ['変換', 'キャスト', '型変換', 'convert'],
  ['追加', 'append', 'push', 'add', '足す'],
  ['検索', '探す', 'search', 'find', '含む', 'contains', 'includes'],
  ['置換', 'replace', '置き換え'],
  ['計算', '算術', '演算', '足し算', '割り算', '余り', 'あまり'],
  ['出力', '表示', 'print', 'println', 'printf', 'console.log'],
  ['クラス', 'class', '構造体', 'struct', 'オブジェクト'],
  ['変数', 'variable', '代入', 'val', 'var', 'let', 'const'],
  ['再帰', 'recursion', '階乗'],
].map((g) => g.map(normalize));

function expand(word: string): string[] {
  const out = new Set([word]);
  for (const g of SYNONYM_GROUPS) if (g.includes(word)) g.forEach((x) => out.add(x));
  return [...out];
}

interface Index {
  topic: Topic;
  title: string;
  keywords: string[];
  summary: string;
  category: string;
  body: string;
}

const INDEX: Index[] = TOPICS.map((topic) => ({
  topic,
  title: normalize(topic.title),
  keywords: topic.keywords.map(normalize),
  summary: normalize(topic.summary),
  category: normalize(topic.category),
  body: normalize(
    Object.values(topic.variants)
      .map((v) => `${v?.code ?? ''} ${v?.note ?? ''}`)
      .join(' '),
  ),
}));

export interface Hit {
  topic: Topic;
  score: number;
  /** タイトル・キーワード・説明のどれかに当たった(コードの中身だけに当たったのではない) */
  strong: boolean;
}

/** 検索語を「言語の指定」と「ふつうの単語」に分ける */
function splitQuery(q: string): { words: string[]; langs: Lang[] } {
  const words: string[] = [];
  const langs: Lang[] = [];
  for (const tok of normalize(q).split(' ').filter(Boolean)) {
    const lang = (Object.keys(LANG_ALIASES) as Lang[]).find((l) => LANG_ALIASES[l].includes(tok));
    // "c" や "py" のような短い語は、言語名として扱う(ほかの単語の一部に当たりすぎるため)
    if (lang && (tok.length <= 2 || LANG_ALIASES[lang].includes(tok))) langs.push(lang);
    else words.push(tok);
  }
  return { words, langs };
}

export function search(query: string, preferred: Lang | null = null): Hit[] {
  const { words, langs } = splitQuery(query);
  const want = [...new Set([...langs, ...(preferred ? [preferred] : [])])];
  const hits: Hit[] = [];
  for (const ix of INDEX) {
    // 言語の指定があるなら、その言語の例文を持つトピックだけ
    if (langs.length && !langs.every((l) => ix.topic.variants[l])) continue;
    let score = 0;
    let all = true;
    let strong = true;
    for (const w of words) {
      let best = 0;
      for (const alt of expand(w)) {
        if (ix.title.includes(alt)) best = Math.max(best, 10);
        for (const k of ix.keywords) {
          if (k === alt) best = Math.max(best, 12);
          else if (k.includes(alt) || (alt === w && k.length >= 3 && k.length * 2 >= alt.length && alt.includes(k))) best = Math.max(best, 8);
        }
        if (ix.category.includes(alt)) best = Math.max(best, 4);
        if (ix.summary.includes(alt)) best = Math.max(best, 3);
        if (ix.body.includes(alt)) best = Math.max(best, 1);
      }
      if (best === 0) {
        all = false;
        break;
      }
      if (best < 3) strong = false;
      score += best;
    }
    if (!all) continue;
    if (!words.length) score = 1;
    // 選んでいる言語の例文があるものを少し上に
    if (want.length && want.every((l) => ix.topic.variants[l])) score += 0.5;
    hits.push({ topic: ix.topic, score, strong });
  }
  // タイトル・キーワード・説明に当たったものがあれば、コードの中身にたまたま当たっただけのものは出さない
  const pool = hits.some((h) => h.strong) ? hits.filter((h) => h.strong) : hits;
  return pool.sort((a, b) => b.score - a.score || TOPICS.indexOf(a.topic) - TOPICS.indexOf(b.topic));
}
