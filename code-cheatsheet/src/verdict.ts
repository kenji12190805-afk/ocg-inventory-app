import { h } from './ui';
import type { Diagnosed } from './errors';

const BANNER = {
  ok: { icon: '✅', label: 'エラーなし' },
  warning: { icon: '⚠️', label: '動くけど、注意' },
  error: { icon: '❌', label: 'エラー' },
} as const;

/** 実行結果の判定(正常/警告/エラー)と、エラーの意味・直し方を見せるカード */
export function verdictCard(d: Diagnosed): HTMLElement {
  const b = BANNER[d.verdict];
  return h(
    'section',
    { class: `verdict ${d.verdict}`, 'aria-live': 'polite' },
    h('div', { class: 'v-head' }, h('span', { class: 'v-icon', 'aria-hidden': 'true' }, b.icon), h('b', null, b.label), d.verdict !== 'ok' ? h('span', { class: 'v-sum' }, d.summary) : null),
    ...d.items.map((i) =>
      h(
        'div',
        { class: `v-item ${i.kind}` },
        h('div', { class: 'v-title' }, i.title),
        h('p', null, i.meaning),
        h('p', { class: 'v-fix' }, h('b', null, '直し方: '), i.fix),
      ),
    ),
    d.lines.length ? h('p', { class: 'v-lines' }, `エディタの ${d.lines.slice(0, 5).join('・')} 行目に色をつけたよ`) : null,
  );
}
