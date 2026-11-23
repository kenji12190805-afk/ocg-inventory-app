import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { TOPICS, topicById, CATEGORIES, LANG_ORDER, LANG_LABEL, LANG_ENGINE, type Topic, type Outcome } from './data/topics';
import { search } from './search';
import { createEditor, type Editor } from './editor';
import { run, preloadPython, onPythonStatus, getPythonStatus, type Lang, type RunResult } from './runners';

// ---------- 小さな部品 ----------
type Child = Node | string | null | false | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') (el as any)[k] = v;
    else if (k === 'class') el.className = v;
    else if (k === 'value' || k === 'disabled' || k === 'checked') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== false && c !== undefined) el.append(c);
  return el;
}

const app = document.getElementById('app')!;
let disposers: (() => void)[] = [];
const dispose = () => {
  disposers.forEach((f) => f());
  disposers = [];
};

function toast(msg: string) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2400);
}

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* 保存できなくても動く */
    }
  },
};

// ---------- 状態 ----------
const isLang = (s: string | null): s is Lang => !!s && (LANG_ORDER as string[]).includes(s);
let preferred: Lang | null = (() => {
  const v = store.get('pref-lang');
  return isLang(v) ? v : null;
})();
let query = '';
/** 編集したコード(画面を移動しても消えないように覚えておく) */
const edits = new Map<string, string>();

type Mode = 'good' | 'bug';
type Route = { name: 'home' } | { name: 'topic'; id: string; lang: Lang; mode: Mode };

function parseHash(): Route {
  const m = /^#\/t\/([\w-]+)(?:\?(.*))?$/.exec(location.hash);
  if (!m) return { name: 'home' };
  const topic = topicById(m[1]);
  if (!topic) return { name: 'home' };
  const p = new URLSearchParams(m[2] ?? '');
  const l = p.get('l');
  const lang: Lang = isLang(l) && topic.variants[l] ? l : (preferred && topic.variants[preferred] ? preferred : LANG_ORDER.find((x) => topic.variants[x])!);
  return { name: 'topic', id: topic.id, lang, mode: p.get('m') === 'bug' && topic.variants[lang]?.bugCode ? 'bug' : 'good' };
}
const topicHash = (id: string, lang: Lang, mode: Mode = 'good') => `#/t/${id}?l=${lang}${mode === 'bug' ? '&m=bug' : ''}`;

function go(hash: string, replace = false) {
  if (replace) {
    history.replaceState(null, '', hash);
    render();
  } else {
    location.hash = hash;
  }
}

// ---------- 共通の枠 ----------
let online = navigator.onLine;
function netBadge(): HTMLElement {
  const el = h('span', { class: `net${online ? '' : ' off'}`, role: 'status' }, online ? 'オンライン' : 'オフライン');
  const update = () => {
    online = navigator.onLine;
    el.textContent = online ? 'オンライン' : 'オフライン';
    el.classList.toggle('off', !online);
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  disposers.push(() => {
    window.removeEventListener('online', update);
    window.removeEventListener('offline', update);
  });
  return el;
}

function langChips(onPick: () => void): HTMLElement {
  const wrap = h('div', { class: 'chips', role: 'group', 'aria-label': '言語を選ぶ' });
  const defs: [Lang | null, string][] = [[null, 'すべて'], ...LANG_ORDER.map((l) => [l, LANG_LABEL[l]] as [Lang, string])];
  for (const [l, label] of defs) {
    wrap.append(
      h(
        'button',
        {
          class: `chip${l ? ` lang-${l}` : ''}`,
          'aria-pressed': String(preferred === l),
          onclick: () => {
            preferred = l;
            store.set('pref-lang', l);
            wrap.querySelectorAll('.chip').forEach((c, i) => c.setAttribute('aria-pressed', String(defs[i][0] === l)));
            onPick();
          },
        },
        l ? h('span', { class: 'dot' }) : null,
        label,
      ),
    );
  }
  return wrap;
}

// ---------- ホーム(検索) ----------
function card(t: Topic): HTMLElement {
  const lang = preferred && t.variants[preferred] ? preferred : LANG_ORDER.find((l) => t.variants[l])!;
  return h(
    'a',
    { class: 'card', href: topicHash(t.id, lang) },
    h('h3', null, t.title),
    h('p', null, t.summary),
    h('div', { class: 'badges' }, ...LANG_ORDER.filter((l) => t.variants[l]).map((l) => h('span', { class: `badge lang-${l}` }, LANG_LABEL[l]))),
  );
}

function renderHome() {
  const input = h('input', {
    type: 'search',
    inputmode: 'search',
    enterkeyhint: 'search',
    placeholder: 'やりたいこと・単語で探す',
    'aria-label': '検索',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    value: query,
  });
  const clear = h('button', { class: 'clear', 'aria-label': '検索をクリア', onclick: () => ((input.value = ''), onInput(), input.focus()) }, '×');
  const list = h('div');

  const buildList = () => {
    const q = query.trim();
    list.replaceChildren();
    if (!q) {
      list.append(
        h('p', { class: 'hint' }, 'やりたいことから、4つの言語の書き方をまとめて探せるよ。'),
        h('div', { class: 'sugg' }, ...['くりかえし', '配列', '文字列', 'エラー', 'null', 'ソート'].map((s) => h('button', { onclick: () => ((input.value = s), onInput()) }, s))),
      );
      for (const cat of CATEGORIES) {
        list.append(h('div', { class: 'cat' }, cat), h('div', { class: 'cards' }, ...TOPICS.filter((t) => t.category === cat).map(card)));
      }
      return;
    }
    const hits = search(q, preferred);
    if (!hits.length) {
      list.append(h('div', { class: 'empty' }, h('p', null, `「${q}」に合う例文は見つからなかったよ`), h('p', { class: 'hint' }, '別の言い方(例: 繰り返し → ループ / for)でも試してみてね')));
      return;
    }
    list.append(h('p', { class: 'hint' }, `${hits.length}件`), h('div', { class: 'cards' }, ...hits.map((x) => card(x.topic))));
  };
  const onInput = () => {
    query = input.value;
    clear.hidden = !query;
    buildList();
  };
  input.addEventListener('input', onInput);
  clear.hidden = !query;
  buildList();

  app.append(
    h(
      'header',
      { class: 'top' },
      h(
        'div',
        { class: 'wrap' },
        h('div', { class: 'brand' }, h('h1', null, 'コード辞典', h('small', null, 'Python / JS / C / Kotlin')), netBadge()),
        h('div', { class: 'search' }, h('span', { class: 'ico', 'aria-hidden': 'true' }, '🔍'), input, clear),
        langChips(() => buildList()),
      ),
    ),
    h(
      'main',
      { class: 'wrap' },
      list,
      h('footer', null, 'ホーム画面に追加すると、アプリみたいに使えて、圏外でも開けるよ。'),
    ),
  );
}

// ---------- 詳細(例文・実行) ----------
function outcomeBlock(label: string, o: Outcome, ms?: number): HTMLElement[] {
  return [
    h(
      'div',
      { class: 'panel-h' },
      h('span', null, label),
      h('span', { class: o.failed ? 'rh-err' : 'rh-ok' }, o.failed ? 'エラー' : '成功', ms !== undefined ? ` · ${Math.round(ms)}ms` : ''),
    ),
    h('pre', { class: `result${o.failed ? ' err' : ''}`, 'aria-live': 'polite' }, o.text || '(出力なし)'),
  ];
}

function renderTopic(route: Extract<Route, { name: 'topic' }>) {
  const topic = topicById(route.id)!;
  const { lang, mode } = route;
  const v = topic.variants[lang]!;
  const original = mode === 'bug' ? v.bugCode! : v.code;
  const recorded: Outcome | undefined = mode === 'bug' ? v.bugOut : v.out;
  const key = `${topic.id}:${lang}:${mode}`;
  let live: RunResult | null = null;
  let running = false;

  // タブ・モード切り替え
  const tabs = h(
    'div',
    { class: 'tabs', role: 'tablist' },
    ...LANG_ORDER.filter((l) => topic.variants[l]).map((l) =>
      h(
        'button',
        { class: `tab lang-${l}`, role: 'tab', 'aria-selected': String(l === lang), onclick: () => go(topicHash(topic.id, l, topic.variants[l]!.bugCode ? mode : 'good'), true) },
        LANG_LABEL[l],
      ),
    ),
  );
  const seg = v.bugCode
    ? h(
        'div',
        { class: 'seg', role: 'group', 'aria-label': '例の種類' },
        h('button', { class: 'good', 'aria-pressed': String(mode === 'good'), onclick: () => go(topicHash(topic.id, lang, 'good'), true) }, '✅ 正しい例'),
        h('button', { class: 'bug', 'aria-pressed': String(mode === 'bug'), onclick: () => go(topicHash(topic.id, lang, 'bug'), true) }, '⚠️ エラーになる例'),
      )
    : null;

  // エディタ
  const editorHost = h('div', { class: 'code' });
  const resultHost = h('div');
  const runBtn = h('button', { class: 'btn primary' });
  const resetBtn = h('button', { class: 'btn', onclick: () => (editor.setText(original), edits.delete(key)) }, '↺ 元に戻す');
  const copyBtn = h('button', { class: 'btn', onclick: copy }, '⧉ コピー');
  const pyStatus = () => getPythonStatus();

  const dirty = () => editor.getText() !== original;

  function refresh() {
    // 実行ボタン
    const busy = running || (lang === 'python' && pyStatus() === 'loading' && running);
    runBtn.disabled = busy || (lang === 'kotlin' && !online);
    runBtn.replaceChildren();
    if (running) {
      runBtn.append(h('span', { class: 'spin' }), lang === 'python' && pyStatus() === 'loading' ? 'Python を準備中…(初回だけ数秒)' : '実行中…');
    } else if (lang === 'kotlin') {
      runBtn.append(online ? '▶ ネットで実行' : 'オフラインでは実行できないよ');
    } else {
      runBtn.append('▶ スマホの中で実行');
    }
    resetBtn.hidden = !dirty();
    // 結果
    resultHost.replaceChildren();
    if (live) {
      resultHost.append(...outcomeBlock('いま実行した結果', { text: live.text, failed: live.failed }, live.ms));
      // C は簡易エンジンなので、本物の gcc の結果も並べて見せる(エラーの出方がちがうことがあるため)
      if (lang === 'c' && recorded && !dirty()) resultHost.append(...outcomeBlock(`記録された結果 — ${LANG_ENGINE[lang]}`, recorded));
    } else if (recorded && !dirty()) {
      resultHost.append(...outcomeBlock(`記録された結果 — ${LANG_ENGINE[lang]}`, recorded));
    } else {
      resultHost.append(h('div', { class: 'panel-h' }, h('span', null, '結果')), h('pre', { class: 'result placeholder' }, '▶ 実行すると、結果がここに出るよ'));
    }
  }

  const editor: Editor = createEditor(editorHost, edits.get(key) ?? original, lang, () => {
    const t = editor.getText();
    if (t === original) edits.delete(key);
    else edits.set(key, t);
    live = null;
    refresh();
  });
  disposers.push(() => editor.destroy());

  async function doRun() {
    if (running) return;
    running = true;
    live = null;
    refresh();
    try {
      live = await run(lang, editor.getText());
    } finally {
      running = false;
      refresh();
    }
  }
  runBtn.onclick = doRun;

  async function copy() {
    const text = editor.getText();
    try {
      await navigator.clipboard.writeText(text);
      toast('コピーしたよ');
    } catch {
      toast('コピーできなかったよ。長押しで選んでコピーしてね');
    }
  }

  if (lang === 'python') {
    preloadPython().catch(() => {});
    disposers.push(onPythonStatus(() => refresh()));
  }
  const onNet = () => {
    online = navigator.onLine;
    refresh();
  };
  window.addEventListener('online', onNet);
  window.addEventListener('offline', onNet);
  disposers.push(() => {
    window.removeEventListener('online', onNet);
    window.removeEventListener('offline', onNet);
  });

  // 他の言語での書き方
  const others = LANG_ORDER.filter((l) => l !== lang && topic.variants[l]);
  const compare = h(
    'details',
    { class: 'cmp' },
    h('summary', null, `ほかの言語ではどう書く?(${others.map((l) => LANG_LABEL[l]).join(' / ')})`),
    ...others.map((l) =>
      h(
        'div',
        { class: `panel mini lang-${l}` },
        h('div', { class: 'panel-h' }, h('span', { class: 'lang' }, LANG_LABEL[l]), h('button', { class: 'btn small', onclick: () => go(topicHash(topic.id, l, 'good'), true) }, 'この言語で開く')),
        h('pre', null, topic.variants[l]!.code),
      ),
    ),
  );

  app.append(
    h(
      'header',
      { class: 'top' },
      h('div', { class: 'wrap' }, h('div', { class: 'brand' }, h('button', { class: 'back', onclick: () => (history.length > 1 ? history.back() : go('#/')) }, '‹ 検索にもどる'), netBadge())),
    ),
    h(
      'main',
      { class: `wrap lang-${lang}` },
      h('h2', { class: 't-title' }, topic.title),
      h('p', { class: 't-sum' }, topic.summary),
      tabs,
      seg,
      mode === 'bug' && v.why ? h('div', { class: 'callout why' }, h('b', null, 'なぜエラーになる?'), v.why) : null,
      mode === 'good' && v.note ? h('div', { class: 'callout point' }, h('b', null, `${LANG_LABEL[lang]} のポイント`), v.note) : null,
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-h' }, h('span', null, `${LANG_LABEL[lang]} のコード(書きかえて試せるよ)`)),
        editorHost,
        h('div', { class: 'actions' }, runBtn, resetBtn, copyBtn),
      ),
      lang === 'kotlin' ? h('div', { class: 'callout warn' }, 'Kotlin は、スマホの中では動かせないので、ネットにつないで公式の Kotlin Playground で実行するよ。オフラインでは、あらかじめ用意した結果(目安)だけ見られる。行・桁の数字は少しずれることがあるよ。') : null,
      lang === 'c' ? h('div', { class: 'callout warn' }, 'C は、スマホの中の小さな C エンジン(picoc)で動かすよ。結果は gcc と同じでも、エラーの文章は gcc とちがうことがあるよ。' + (topic.picocMatches ? '' : ' この例は結果もちがう場合があるよ。')) : null,
      h('section', { class: 'panel' }, resultHost),
      compare,
      h('footer', null, '例文の結果は、Python(Pyodide)・JavaScript(V8)・C(gcc)の本物の処理系で実際に動かして記録しているよ。'),
    ),
  );
  refresh();
}

// ---------- ルーティング ----------
let lastKey = '';
function render() {
  dispose();
  const route = parseHash();
  app.replaceChildren();
  const k = route.name === 'home' ? 'home' : `topic:${route.id}`;
  if (route.name === 'home') {
    renderHome();
    document.title = 'コード辞典';
  } else {
    renderTopic(route);
    document.title = `${topicById(route.id)!.title} | コード辞典`;
  }
  if (k !== lastKey) window.scrollTo(0, 0);
  lastKey = k;
}
window.addEventListener('hashchange', render);
render();

// Service Worker が使えない環境(埋め込み表示など)でも、画面はそのまま動かす
try {
  registerSW({
    immediate: true,
    onOfflineReady() {
      toast('オフラインでも使える準備ができたよ');
    },
    onRegisterError() {
      /* オフライン保存なしで動く */
    },
  });
} catch {
  /* オフライン保存なしで動く */
}
