import type { Lang } from './runners/types';
import { LANG_LABEL } from './data/topics';
import type { Diagnosed } from './errors';

export type Ask = 'fix' | 'explain' | 'continue' | 'none';
export const ASK_LABEL: Record<Ask, string> = {
  fix: '直して',
  explain: '説明して',
  continue: '続きを書いて',
  none: 'お願いなし',
};
/** Claude に頼むときの一言。返事を短くして、トークンを節約する書き方にしている */
const ASK_TEXT: Record<Ask, string> = {
  fix: '直して。直した全コードだけ返して(説明は1〜2行)。',
  explain: '何をしているか、短く説明して。',
  continue: 'このコードの続きを書いて。追加部分だけ返して。',
  none: '',
};

const FENCE: Record<Lang, string> = { python: 'python', javascript: 'js', c: 'c', kotlin: 'kotlin' };

/** 長い出力は、最初と最後だけ残す(エラーの原因は両端に出ることが多い) */
export function trimOutput(text: string, head = 5, tail = 6): string {
  const lines = text.replace(/\s+$/, '').split('\n');
  if (lines.length <= head + tail + 1) return lines.join('\n');
  return [...lines.slice(0, head), `…(${lines.length - head - tail}行 省略)…`, ...lines.slice(-tail)].join('\n');
}

export interface Bundle {
  lang: Lang;
  code: string;
  note: string;
  ask: Ask;
  withResult: boolean;
  result?: { text: string; failed: boolean };
  diagnosis?: Diagnosed;
}

export function buildMessage(b: Bundle): string {
  const parts: string[] = [];
  parts.push(`【${LANG_LABEL[b.lang]}】${b.note.trim() ? b.note.trim() : ''}`.trimEnd());
  parts.push('```' + FENCE[b.lang] + '\n' + b.code.replace(/\s+$/, '') + '\n```');
  if (b.withResult && b.result) {
    const mark = b.diagnosis?.verdict === 'ok' ? '正常' : b.diagnosis?.verdict === 'warning' ? '警告' : 'エラー';
    const sum = b.diagnosis && b.diagnosis.verdict !== 'ok' ? ` ${b.diagnosis.summary}` : '';
    const body = trimOutput(b.result.text);
    parts.push(`【結果:${mark}${sum}】\n` + (body ? '```\n' + body + '\n```' : '(出力なし)'));
  }
  if (ASK_TEXT[b.ask]) parts.push(ASK_TEXT[b.ask]);
  return parts.join('\n');
}

/** ざっくりのトークン数(日本語は1文字≒1トークン、英数字は4文字≒1トークンで見積もる) */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of text) (ch.charCodeAt(0) < 128 ? ascii++ : other++);
  return Math.ceil(ascii / 4 + other * 1.0);
}
