import type { Lang } from '../runners/types';
import type { Entry } from './types.ts';
import { python } from './python.ts';
import { javascript } from './javascript.ts';
import { c } from './c.ts';
import { kotlin } from './kotlin.ts';

export type { Entry } from './types.ts';

export const DICT: Record<Lang, Entry[]> = { python, javascript, c, kotlin };

/** 全角半角・大文字小文字・カタカナ/ひらがなのゆれをなくす(search.ts と同じ考え方。Node からも使えるよう、ここに持つ) */
export function norm(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .trim();
}

/** ひな形の穴(${1:初期値})を、初期値で埋めた「そのまま動く形」にする */
export function expandDefault(t: string, raw = false): string {
  if (raw) return t;
  const defaults = new Map<string, string>();
  t.replace(/\$\{(\d+):([^}]*)\}/g, (_m, n: string, d: string) => {
    if (!defaults.has(n)) defaults.set(n, d);
    return '';
  });
  return t.replace(/\$\{(\d+)(?::([^}]*))?\}/g, (_m, n: string, d?: string) => d ?? defaults.get(n) ?? '');
}

/** 意味の最初の1文(候補の横に出す短い説明) */
export const shortMeaning = (m: string) => m.split(/[。\n]/)[0].slice(0, 22);

/** 漢字の言い換えの「読み」(ひらがなで打っても候補に出す) */
const READINGS: Record<string, string> = {
  追加: 'ついか', 削除: 'さくじょ', 消す: 'けす', 足す: 'たす', 並べ替え: 'ならべかえ', 昇順: 'しょうじゅん', 降順: 'こうじゅん', 合計: 'ごうけい', 変換: 'へんかん', 型変換: 'かたへんかん',
  分岐: 'ぶんき', 条件: 'じょうけん', 条件分岐: 'じょうけんぶんき', 関数: 'かんすう', 変数: 'へんすう', 文字列: 'もじれつ', 文字数: 'もじすう', 配列: 'はいれつ', 辞書: 'じしょ',
  例外: 'れいがい', 再帰: 'さいき', 含む: 'ふくむ', 検索: 'けんさく', 探す: 'さがす', 置換: 'ちかん', 置き換え: 'おきかえ', 分割: 'ぶんかつ', 区切る: 'くぎる', 結合: 'けつごう', 連結: 'れんけつ',
  大文字: 'おおもじ', 小文字: 'こもじ', 最大: 'さいだい', 最小: 'さいしょう', 出力: 'しゅつりょく', 表示: 'ひょうじ', 繰り返し: 'くりかえし', 絞り込み: 'しぼりこみ', 絞る: 'しぼる',
  代入: 'だいにゅう', 定数: 'ていすう', 整数: 'せいすう', 小数: 'しょうすう', 長さ: 'ながさ', 個数: 'こすう', 空白: 'くうはく', 余白: 'よはく', 論理: 'ろんり', 真偽: 'しんぎ', 値がない: 'あたいがない',
  一部: 'いちぶ', 切り出し: 'きりだし', 丸める: 'まるめる', 四捨五入: 'ししゃごにゅう', 切り捨て: 'きりすて', 絶対値: 'ぜったいち', 戻り値: 'もどりち', 返す: 'かえす', 抜ける: 'ぬける', 中断: 'ちゅうだん',
  構造体: 'こうぞうたい', 入口: 'いりぐち', 回数: 'かいすう', 全部: 'ぜんぶ', 変更できる: 'へんこうできる', 安全: 'あんぜん', 埋め込む: 'うめこむ', 場合分け: 'ばあいわけ', 番号つき: 'ばんごうつき',
  動的: 'どうてき', 確保: 'かくほ', 比較: 'ひかく', 比べる: 'くらべる', 同じ: 'おなじ', 等しい: 'ひとしい', 三項: 'さんこう', 短い: 'みじかい', 数値: 'すうち', 型: 'かた', 画面に出す: 'がめんにだす',
};
const withReadings = (aliases: string[]) => [...aliases, ...aliases.map((a) => READINGS[a]).filter((r): r is string => !!r)];

const ASCII = /^[\x00-\x7f]*$/;
const strip = (s: string) => s.replace(/^[.#]+/, '');

/** 打ち込んだ文字(英語・日本語どちらでも)から、関連する項目を探す */
export function suggest(lang: Lang, rawQuery: string, explicit = false): Entry[] {
  const list = DICT[lang];
  // nums.app → app (最後の . のあとだけで探す)
  const q = norm(strip(rawQuery.includes('.') && !rawQuery.startsWith('.') ? rawQuery.slice(rawQuery.lastIndexOf('.') + 1) : rawQuery));
  if (!q) return explicit ? list.slice(0, 12) : [];
  const scored: { e: Entry; s: number; i: number }[] = [];
  list.forEach((e, i) => {
    const label = norm(strip(e.l));
    const words = (e.w ?? []).map(norm);
    const aliases = withReadings(e.a ?? []).map(norm);
    let s = 0;
    if (words.includes(q) || label === q) s = 120;
    else if (label.startsWith(q)) s = 100;
    else if (words.some((w) => w.startsWith(q))) s = 90;
    else if (aliases.includes(q)) s = 80;
    else if (aliases.some((a) => a.startsWith(q))) s = 60;
    else if (q.length >= 2 || !ASCII.test(q)) {
      if (label.includes(q)) s = 50;
      else if (aliases.some((a) => a.includes(q))) s = 40;
    }
    if (s) scored.push({ e, s, i });
  });
  return scored.sort((a, b) => b.s - a.s || a.i - b.i).slice(0, 10).map((x) => x.e);
}

const wordIndex = new Map<Lang, Map<string, Entry>>();
/** コードの中の言葉(for, print, append など)の意味を引く */
export function lookupWord(lang: Lang, word: string): Entry | null {
  let idx = wordIndex.get(lang);
  if (!idx) {
    idx = new Map();
    for (const e of DICT[lang]) for (const w of e.w ?? []) if (!idx.has(w)) idx.set(w, e);
    wordIndex.set(lang, idx);
  }
  return idx.get(word) ?? null;
}
