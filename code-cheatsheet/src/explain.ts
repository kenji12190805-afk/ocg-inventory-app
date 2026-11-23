import type { Lang } from './runners/types';
import { lookupWord, shortMeaning } from './dict/index.ts';

/**
 * 1行のコードを、やさしい日本語にする(コードの下にコメントとして見せる用)。
 * 行の「書き方」を見分けるだけで、プログラムを実行はしない。わからない行は null を返す。
 */

const c = (s: string) => `「${s.trim()}」`;
const num = (s: string) => /^-?\d+$/.test(s.trim());
/** 最後の値(b の1つ手前)を言葉にする。数字なら計算して見せる */
const before = (b: string) => (num(b) ? String(Number(b.trim()) - 1) : `${b.trim()} の1つ手前`);
/** コードの断片を、読みやすい日本語にする(ごく簡単なもの) */
function phrase(expr: string): string {
  const e = expr.trim();
  let m: RegExpExecArray | null;
  if (e === '[]' || e === 'listOf()' || e === 'mutableListOf()') return '空のリスト';
  if (e === '{}' && !e.includes(':')) return '空の入れ物';
  if (/^(None|null|undefined|NULL)$/.test(e)) return '「なし」(値がない)';
  if (/^(True|true)$/.test(e)) return '「はい」(true)';
  if (/^(False|false)$/.test(e)) return '「いいえ」(false)';
  if ((m = /^len\((.+)\)$/.exec(e))) return `${c(m[1])} の長さ`;
  if ((m = /^(\w[\w.]*)\.(?:length|size)$/.exec(e))) return `${c(m[1])} の長さ`;
  if ((m = /^(?:int|Number|parseInt|toInt)\((.+)\)$/.exec(e)) || (m = /^(.+)\.toInt\(\)$/.exec(e))) return `${c(m[1])} を整数にしたもの`;
  if ((m = /^(?:float|parseFloat|toDouble)\((.+)\)$/.exec(e)) || (m = /^(.+)\.toDouble\(\)$/.exec(e))) return `${c(m[1])} を小数にしたもの`;
  if ((m = /^(?:str|String)\((.+)\)$/.exec(e))) return `${c(m[1])} を文字列にしたもの`;
  if ((m = /^input\(.*\)$/.exec(e))) return '入力された文字';
  if ((m = /^\[(.*)\]$/.exec(e))) return m[1].trim() ? `リスト ${c(m[1])}` : '空のリスト';
  if ((m = /^(?:listOf|mutableListOf)\((.*)\)$/.exec(e))) return `リスト ${c(m[1])}`;
  if ((m = /^(?:mapOf|mutableMapOf)\((.*)\)$/.exec(e))) return `キーと値の入れ物 ${c(m[1])}`;
  if (/^\{.+\}$/.test(e) && e.includes(':')) return `キーと値の入れ物 ${c(e)}`;
  if (/^f".*"$/.test(e) || /^`.*\$\{.*`$/.test(e) || /^".*\$.*"$/.test(e)) return `${c(e)}(変数を文字の中に埋め込んだ文字列)`;
  return c(e);
}

type Rule = [RegExp, (m: RegExpExecArray) => string | null];

// 数値の計算の記号
const OPS: Record<string, string> = { '+=': 'を足す', '-=': 'を引く', '*=': 'をかける', '/=': 'で割る', '%=': 'で割ったあまりにする' };
const augmented = (m: RegExpExecArray) => {
  const op = m[2];
  return op === '-=' ? `${c(m[1])} から ${c(m[3])} を引く` : op === '*=' ? `${c(m[1])} に ${c(m[3])} をかける` : op === '/=' ? `${c(m[1])} を ${c(m[3])} で割る` : op === '%=' ? `${c(m[1])} を ${c(m[3])} で割ったあまりにする` : `${c(m[1])} に ${c(m[3])} ${OPS[op]}`;
};
const incdec = (m: RegExpExecArray) => (m[2] === '++' ? `${c(m[1])} を 1 増やす` : `${c(m[1])} を 1 減らす`);

const HEADERS: Record<string, string> = {
  'stdio.h': 'printf など、画面への出力',
  'string.h': 'strlen など、文字列の道具',
  'stdlib.h': 'atoi・malloc など',
  'math.h': 'sqrt など、計算の道具',
  'ctype.h': 'toupper など、文字の判定',
  'stdbool.h': 'true / false',
};
const CTYPE: Record<string, string> = { int: '整数', long: '大きな整数', short: '小さな整数', double: '小数', float: '小数', char: '1文字', unsigned: '0以上の整数', size_t: '大きさを表す整数' };

// ---- 共通の部品: 呼び出しだけの行(辞書にあればその意味を使う) ----
function callLine(lang: Lang, name: string): string {
  const last = name.split('.').pop() ?? name;
  const e = lookupWord(lang, last);
  return e ? `${c(name)}: ${shortMeaning(e.m)}` : `関数 ${c(name)} を呼ぶ`;
}

// ---------------- Python ----------------
const PY: Rule[] = [
  [/^from\s+(\S+)\s+import\s+(.+)$/, (m) => `${c(m[1])} の ${c(m[2])} を使えるようにする`],
  [/^import\s+(.+)$/, (m) => `${c(m[1])} の部品を使えるようにする`],
  [/^def\s+(\w+)\s*\((.*)\)\s*(?:->\s*[^:]+)?:$/, (m) => (m[2].trim() ? `関数 ${c(m[1])} を作る(受け取る値: ${m[2].trim()})` : `関数 ${c(m[1])} を作る(受け取る値なし)`)],
  [/^class\s+(\w+)(?:\(.*\))?:$/, (m) => `クラス ${c(m[1])} を作る(データと処理をまとめたひな形)`],
  [/^if\s+(.+):$/, (m) => `もし ${c(m[1])} なら`],
  [/^elif\s+(.+):$/, (m) => `そうでなくて、${c(m[1])} なら`],
  [/^else\s*:$/, () => 'どれにも当てはまらなければ'],
  [/^for\s+(\w+)\s+in\s+range\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)\s*:$/, (m) => `${c(m[1])} を ${m[2]} から ${before(m[3])} までくりかえす`],
  [/^for\s+(\w+)\s+in\s+range\(\s*([^,()]+?)\s*\)\s*:$/, (m) => `${c(m[1])} を 0 から ${before(m[2])} までくりかえす`],
  [/^for\s+(\w+)\s*,\s*(\w+)\s+in\s+enumerate\((.+?)(?:,.*)?\)\s*:$/, (m) => `${c(m[3])} を番号つきで1つずつ取り出す(番号: ${m[1]}、中身: ${m[2]})`],
  [/^for\s+(\w+)\s*,\s*(\w+)\s+in\s+(.+?)\.items\(\)\s*:$/, (m) => `${c(m[3])} のキーと値を1組ずつ取り出す(キー: ${m[1]}、値: ${m[2]})`],
  [/^for\s+(\w+)\s+in\s+(.+):$/, (m) => `${c(m[2])} の中身を1つずつ ${c(m[1])} に入れて、くりかえす`],
  [/^while\s+(.+):$/, (m) => `${c(m[1])} の間、くりかえす`],
  [/^try\s*:$/, () => 'エラーが起きるかもしれない処理(ここから)'],
  [/^except(?:\s+([\w., ()]+?))?(?:\s+as\s+\w+)?\s*:$/, (m) => (m[1] ? `${m[1]} のエラーが起きたら` : 'エラーが起きたら')],
  [/^finally\s*:$/, () => '成功しても失敗しても、最後に必ず実行する'],
  [/^match\s+(.+):$/, (m) => `${c(m[1])} の値で分ける`],
  [/^case\s+_\s*:$/, () => 'どれでもないとき'],
  [/^case\s+(.+):$/, (m) => `${c(m[1])} のとき`],
  [/^return(?:\s+(.+))?$/, (m) => (m[1] ? `${c(m[1])} を結果として返して、関数を終わる` : '関数を終わる')],
  [/^break$/, () => 'くりかえしを、ここで終わらせる'],
  [/^continue$/, () => '今回はここまでにして、次のくりかえしへ'],
  [/^pass$/, () => '何もしない'],
  [/^print\(\s*\)$/, () => '空の行を画面に出す'],
  [/^print\((.*)\)$/, (m) => `${phrase(m[1].replace(/,\s*end=.*$/, ''))} を画面に出す`],
  [/^(\w[\w.]*)\.append\((.+)\)$/, (m) => `${c(m[1])} の後ろに ${c(m[2])} を足す`],
  [/^(\w[\w.]*)\.remove\((.+)\)$/, (m) => `${c(m[1])} から ${c(m[2])} を消す`],
  [/^(\w+)\s*(\+=|-=|\*=|\/=|%=)\s*(.+)$/, augmented],
  [/^(\w+)\s*=\s*(.+)$/, (m) => `${c(m[1])} に ${phrase(m[2])} を入れる`],
  [/^([A-Za-z_][\w.]*)\((.*)\)$/, (m) => callLine('python', m[1])],
];

// ---------------- JavaScript ----------------
const FOR_C = /^for\s*\(\s*(?:let|const|var|int)?\s*(\w+)\s*=\s*([^;]+?)\s*;\s*\1\s*(<=|<)\s*([^;]+?)\s*;\s*(?:\1\+\+|\+\+\1|\1\s*\+=\s*1)\s*\)$/;
const forC = (m: RegExpExecArray) => `${c(m[1])} を ${m[2].trim()} から ${m[3] === '<' ? before(m[4]) : m[4].trim()} までくりかえす`;

const JS: Rule[] = [
  [/^\} else if\s*\((.+)\)$/, (m) => `そうでなくて、${c(m[1])} なら`],
  [/^\} else$/, () => 'どれにも当てはまらなければ'],
  [/^\} catch(?:\s*\((\w+)\))?$/, () => 'エラーが起きたら'],
  [/^\} finally$/, () => '成功しても失敗しても、最後に必ず実行する'],
  [/^function\s+(\w+)\s*\((.*)\)$/, (m) => (m[2].trim() ? `関数 ${c(m[1])} を作る(受け取る値: ${m[2].trim()})` : `関数 ${c(m[1])} を作る(受け取る値なし)`)],
  [/^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(?([\w\s,]*)\)?\s*=>.*$/, (m) => `関数 ${c(m[1])} を作る(短い書き方)`],
  [/^class\s+(\w+)(?:\s+extends\s+\w+)?$/, (m) => `クラス ${c(m[1])} を作る(データと処理をまとめたひな形)`],
  [/^constructor\s*\((.*)\)$/, () => '作ったときに最初に呼ばれる処理(初期化)'],
  [/^if\s*\((.+)\)$/, (m) => `もし ${c(m[1])} なら`],
  [FOR_C, forC],
  [/^for\s*\(\s*(?:const|let|var)\s+(\w+)\s+of\s+(.+)\)$/, (m) => `${c(m[2])} の中身を1つずつ ${c(m[1])} に入れて、くりかえす`],
  [/^for\s*\(\s*(?:const|let|var)\s+(\w+)\s+in\s+(.+)\)$/, (m) => `${c(m[2])} の「番号(キー)」を1つずつ ${c(m[1])} に入れて、くりかえす`],
  [/^while\s*\((.+)\)$/, (m) => `${c(m[1])} の間、くりかえす`],
  [/^do$/, () => 'まず1回実行して、そのあと条件を調べてくりかえす'],
  [/^try$/, () => 'エラーが起きるかもしれない処理(ここから)'],
  [/^switch\s*\((.+)\)$/, (m) => `${c(m[1])} の値で分ける`],
  [/^case\s+(.+):$/, (m) => `${c(m[1])} のとき`],
  [/^default\s*:$/, () => 'どれでもないとき'],
  [/^return(?:\s+(.+))?$/, (m) => (m[1] ? `${c(m[1])} を結果として返して、関数を終わる` : '関数を終わる')],
  [/^break$/, () => 'くりかえし(や switch)を、ここで終わらせる'],
  [/^continue$/, () => '今回はここまでにして、次のくりかえしへ'],
  [/^throw\s+(.+)$/, (m) => `エラー ${c(m[1])} を投げる`],
  [/^console\.(?:log|info|warn|error)\(\s*\)$/, () => '空の行を画面に出す'],
  [/^console\.(?:log|info|warn|error)\((.*)\)$/, (m) => `${phrase(m[1])} を画面に出す`],
  [/^(\w[\w.]*)\.push\((.+)\)$/, (m) => `${c(m[1])} の後ろに ${c(m[2])} を足す`],
  [/^(\w[\w.]*)\.splice\((.+)\)$/, (m) => `${c(m[1])} の途中を取り除く`],
  [/^(\w+)\s*(\+\+|--)$/, incdec],
  [/^(\w+)\s*(\+=|-=|\*=|\/=|%=)\s*(.+)$/, augmented],
  [/^const\s+(\w+)\s*=\s*(.+)$/, (m) => `${c(m[1])} に ${phrase(m[2])} を入れる(あとで入れ直せない)`],
  [/^(?:let|var)\s+(\w+)\s*=\s*(.+)$/, (m) => `${c(m[1])} に ${phrase(m[2])} を入れる`],
  [/^(?:let|var)\s+(\w+)$/, (m) => `変数 ${c(m[1])} を作る(まだ空)`],
  [/^(\w+)\s*=\s*(.+)$/, (m) => `${c(m[1])} に ${phrase(m[2])} を入れる`],
  [/^([A-Za-z_][\w.]*)\((.*)\)$/, (m) => callLine('javascript', m[1])],
];

// ---------------- C ----------------
const C: Rule[] = [
  [/^#include\s*[<"]([\w./]+)[>"]$/, (m) => `${c(m[1])} の部品を使えるようにする${HEADERS[m[1]] ? `(${HEADERS[m[1]]})` : ''}`],
  [/^#define\s+(\w+)\s+(.+)$/, (m) => `${c(m[1])} という名前で ${c(m[2])} を使えるようにする`],
  [/^\} else if\s*\((.+)\)$/, (m) => `そうでなくて、${c(m[1])} なら`],
  [/^\} else$/, () => 'どれにも当てはまらなければ'],
  [/^int\s+main\s*\(.*\)$/, () => 'プログラムの入口(ここから実行が始まる)'],
  [/^struct\s+(\w+)$/, (m) => `構造体 ${c(m[1])} を作る(複数のデータをまとめた型)`],
  [/^(?:static\s+)?(int|void|double|float|char\s*\*?|long)\s+(\w+)\s*\((.*)\)$/, (m) => (m[3].trim() && m[3].trim() !== 'void' ? `関数 ${c(m[2])} を作る(受け取る値: ${m[3].trim()}。返す型: ${m[1].replace(/\s+/g, '')})` : `関数 ${c(m[2])} を作る(受け取る値なし)`)],
  [/^if\s*\((.+)\)$/, (m) => `もし ${c(m[1])} なら`],
  [FOR_C, forC],
  [/^while\s*\((.+)\)$/, (m) => `${c(m[1])} の間、くりかえす`],
  [/^switch\s*\((.+)\)$/, (m) => `${c(m[1])} の値で分ける`],
  [/^case\s+(.+):$/, (m) => `${c(m[1])} のとき`],
  [/^default\s*:$/, () => 'どれでもないとき'],
  [/^return\s+0$/, () => 'プログラムを正常に終わる(0 は成功の意味)'],
  [/^return(?:\s+(.+))?$/, (m) => (m[1] ? `${c(m[1])} を結果として返して、関数を終わる` : '関数を終わる')],
  [/^break$/, () => 'くりかえし(や switch)を、ここで終わらせる'],
  [/^continue$/, () => '今回はここまでにして、次のくりかえしへ'],
  [/^printf\((.*)\)$/, (m) => `${c(m[1])} を画面に出す(%d は整数、%s は文字列の場所。\\n は改行)`],
  [/^(\w+)\s*(\+\+|--)$/, incdec],
  [/^(\w+)\s*(\+=|-=|\*=|\/=|%=)\s*(.+)$/, augmented],
  [/^(?:const\s+)?(int|long|short|double|float|char|unsigned|size_t)\s+(\*?)(\w+)\s*\[([^\]]*)\]\s*(?:=\s*(.+))?$/, (m) => `${CTYPE[m[1]] ?? m[1]}の配列 ${c(m[3])} を作る${m[4].trim() ? `(大きさ ${m[4].trim()})` : ''}${m[5] ? `。最初の中身は ${c(m[5])}` : ''}`],
  [/^(?:const\s+)?(int|long|short|double|float|char|unsigned|size_t)\s+(\*)(\w+)\s*(?:=\s*(.+))?$/, (m) => `${CTYPE[m[1]] ?? m[1]}を指す「ポインタ」${c(m[3])} を作る${m[4] ? `(最初は ${c(m[4])})` : ''}`],
  [/^(?:const\s+)?(int|long|short|double|float|char|unsigned|size_t)\s+(\w+)\s*(?:=\s*(.+))?$/, (m) => `${CTYPE[m[1]] ?? m[1]}の変数 ${c(m[2])} を作る${m[3] ? `。最初の値は ${phrase(m[3])}` : ''}`],
  [/^(\w+)\s*=\s*(.+)$/, (m) => `${c(m[1])} に ${phrase(m[2])} を入れる`],
  [/^([A-Za-z_]\w*)\((.*)\)$/, (m) => callLine('c', m[1])],
];

// ---------------- Kotlin ----------------
const KT: Rule[] = [
  [/^\} else if\s*\((.+)\)$/, (m) => `そうでなくて、${c(m[1])} なら`],
  [/^\} else$/, () => 'どれにも当てはまらなければ'],
  [/^\} catch\s*\((\w+)\s*:\s*([\w.]+)\)$/, (m) => `${m[2]} のエラーが起きたら`],
  [/^\} finally$/, () => '成功しても失敗しても、最後に必ず実行する'],
  [/^fun\s+main\s*\(.*\)$/, () => 'プログラムの入口(ここから実行が始まる)'],
  [/^fun\s+(\w+)\s*\((.*)\)\s*(?::\s*(\w+))?\s*(?:=.*)?$/, (m) => (m[2].trim() ? `関数 ${c(m[1])} を作る(受け取る値: ${m[2].trim()}${m[3] ? `。返す型: ${m[3]}` : ''})` : `関数 ${c(m[1])} を作る(受け取る値なし)`)],
  [/^(?:data\s+)?class\s+(\w+)(?:\((.*)\))?$/, (m) => `クラス ${c(m[1])} を作る(データと処理をまとめたひな形)`],
  [/^if\s*\((.+)\)$/, (m) => `もし ${c(m[1])} なら`],
  [/^for\s*\(\s*(\w+)\s+in\s+(\S+?)\.\.(\S+?)\s*\)$/, (m) => `${c(m[1])} を ${m[2]} から ${m[3]} までくりかえす`],
  [/^for\s*\(\s*(\w+)\s+in\s+(\S+?)\s+until\s+(\S+?)\s*\)$/, (m) => `${c(m[1])} を ${m[2]} から ${before(m[3])} までくりかえす`],
  [/^for\s*\(\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)\s+in\s+(.+?)\.withIndex\(\)\s*\)$/, (m) => `${c(m[3])} を番号つきで1つずつ取り出す(番号: ${m[1]}、中身: ${m[2]})`],
  [/^for\s*\(\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)\s+in\s+(.+)\)$/, (m) => `${c(m[3])} のキーと値を1組ずつ取り出す(キー: ${m[1]}、値: ${m[2]})`],
  [/^for\s*\(\s*(\w+)\s+in\s+(.+)\)$/, (m) => `${c(m[2])} の中身を1つずつ ${c(m[1])} に入れて、くりかえす`],
  [/^while\s*\((.+)\)$/, (m) => `${c(m[1])} の間、くりかえす`],
  [/^when\s*\((.+)\)$/, (m) => `${c(m[1])} の値で分ける`],
  [/^when$/, () => '上から順に条件を調べて、最初に当てはまったものを実行'],
  [/^try$/, () => 'エラーが起きるかもしれない処理(ここから)'],
  [/^else\s*->\s*(.+)$/, (m) => `どれでもないとき: ${explainInner('kotlin', m[1])}`],
  [/^([^{}=]+?)\s*->\s*(.+)$/, (m) => `${c(m[1])} のとき: ${explainInner('kotlin', m[2])}`],
  [/^return(?:\s+(.+))?$/, (m) => (m[1] ? `${c(m[1])} を結果として返して、関数を終わる` : '関数を終わる')],
  [/^break$/, () => 'くりかえしを、ここで終わらせる'],
  [/^continue$/, () => '今回はここまでにして、次のくりかえしへ'],
  [/^println\(\s*\)$/, () => '空の行を画面に出す'],
  [/^(?:println|print)\((.*)\)$/, (m) => `${phrase(m[1])} を画面に出す`],
  [/^repeat\((.+)\)$/, (m) => `${c(m[1])} 回くりかえす`],
  [/^(\w[\w.]*)\.add\((.+)\)$/, (m) => `${c(m[1])} の後ろに ${c(m[2])} を足す`],
  [/^(\w[\w.]*)\.removeAt\((.+)\)$/, (m) => `${c(m[1])} の ${c(m[2])} 番を消す`],
  [/^(\w+)\s*(\+\+|--)$/, incdec],
  [/^(\w+)\s*(\+=|-=|\*=|\/=|%=)\s*(.+)$/, augmented],
  [/^val\s+(\w+)(?:\s*:\s*[\w?<>, ]+)?\s*=\s*(.+)$/, (m) => `${c(m[1])} に ${phrase(m[2])} を入れる(あとで入れ直せない)`],
  [/^var\s+(\w+)(?:\s*:\s*[\w?<>, ]+)?\s*=\s*(.+)$/, (m) => `${c(m[1])} に ${phrase(m[2])} を入れる`],
  [/^(\w+)\s*=\s*(.+)$/, (m) => `${c(m[1])} に ${phrase(m[2])} を入れる`],
  [/^([A-Za-z_][\w.]*)\((.*)\)$/, (m) => callLine('kotlin', m[1])],
];

const RULES: Record<Lang, Rule[]> = { python: PY, javascript: JS, c: C, kotlin: KT };

function explainInner(lang: Lang, stmt: string): string {
  return explainLine(lang, stmt) ?? c(stmt);
}

/** 1行を日本語にする。コメント・空行・閉じかっこだけの行・わからない行は null */
export function explainLine(lang: Lang, rawLine: string): string | null {
  let t = rawLine.trim();
  if (!t) return null;
  if (t.startsWith('#') && lang !== 'c') return null; // Python のコメント
  if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) return null;
  if (lang === 'c' && t.startsWith('#') && !/^#(include|define)\b/.test(t)) return null;
  if (/^[}\])]+[;,]?$/.test(t)) return null;
  // 行の最後の ; と、ブロックを開く { をはずして、書き方を見分けやすくする
  t = t.replace(/;\s*$/, '');
  if (lang !== 'python') t = t.replace(/\s*\{\s*$/, '');
  for (const [re, fn] of RULES[lang]) {
    const m = re.exec(t);
    if (m) return fn(m);
  }
  return null;
}

/** コード全体を、行ごとに日本語にする(説明のない行は null) */
export function explainCode(lang: Lang, code: string): (string | null)[] {
  return code.split('\n').map((l) => explainLine(lang, l));
}

export const COMMENT_PREFIX: Record<Lang, string> = { python: '# ', javascript: '// ', c: '// ', kotlin: '// ' };
