import { h, toast, store, onDispose, netBadge, copyText } from './ui';
import { LANG_ORDER, LANG_LABEL } from './data/topics';
import { createEditor, entryDom, type Editor, type WordInfo } from './editor';
import { expandDefault } from './dict/index.ts';
import { run, check, canCheck, preloadPython, onPythonStatus, getPythonStatus, type Lang, type RunResult } from './runners';
import { diagnose, type Diagnosed } from './errors';
import { verdictCard } from './verdict';
import { buildMessage, estimateTokens, ASK_LABEL, type Ask } from './claude';

const STARTER: Record<Lang, string> = {
  python: 'name = "ケンジ"\nprint(f"こんにちは、{name}さん")\n',
  javascript: 'const name = "ケンジ";\nconsole.log(`こんにちは、${name}さん`);\n',
  c: '#include <stdio.h>\n\nint main(void) {\n    printf("Hello, World!\\n");\n    return 0;\n}\n',
  kotlin: 'fun main() {\n    println("こんにちは")\n}\n',
};
const EXT: Record<Lang, string> = { python: 'main.py', javascript: 'main.js', c: 'main.c', kotlin: 'main.kt' };

/** スマホで打ちにくい記号を、ワンタップで入れるバー(back: 入れたあとにカーソルを戻す文字数) */
interface Key {
  label: string;
  text: string;
  back?: number;
}
const COMMON: Key[] = [
  { label: '( )', text: '()', back: 1 },
  { label: '[ ]', text: '[]', back: 1 },
  { label: '{ }', text: '{}', back: 1 },
  { label: '" "', text: '""', back: 1 },
  { label: "' '", text: "''", back: 1 },
  { label: '=', text: ' = ' },
  { label: '.', text: '.' },
  { label: ',', text: ', ' },
];
const KEYS: Record<Lang, Key[]> = {
  python: [{ label: ':', text: ':' }, ...COMMON, { label: '#', text: '# ' }, { label: '_', text: '_' }],
  javascript: [{ label: ';', text: ';' }, ...COMMON, { label: '=>', text: ' => ' }, { label: '`', text: '``', back: 1 }, { label: '//', text: '// ' }],
  c: [{ label: ';', text: ';' }, ...COMMON, { label: '%d', text: '%d' }, { label: '\\n', text: '\\n' }, { label: '&', text: '&' }, { label: '*', text: '*' }, { label: '#', text: '#' }],
  kotlin: [...COMMON, { label: '->', text: ' -> ' }, { label: '?.', text: '?.' }, { label: '$', text: '$' }, { label: '//', text: '// ' }],
};

interface Snippet {
  id: string;
  name: string;
  lang: Lang;
  code: string;
  at: number;
}
const loadSnippets = (): Snippet[] => {
  try {
    const v = JSON.parse(store.get('snippets') ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const saveSnippets = (s: Snippet[]) => store.set('snippets', JSON.stringify(s.slice(0, 50)));

export function renderEditorPage(app: HTMLElement, lang: Lang, go: (hash: string, replace?: boolean) => void) {
  let result: RunResult | null = null;
  let diag: Diagnosed | null = null;
  let busy: 'run' | 'check' | null = null;
  let ask: Ask = (store.get('ask') as Ask) in ASK_LABEL ? (store.get('ask') as Ask) : 'fix';
  let withResult = true;

  const draftKey = `draft:${lang}`;
  const initial = store.get(draftKey) ?? STARTER[lang];

  // ---- 部品 ----
  const editorHost = h('div', { class: 'code editor-big' });
  const resultHost = h('div');
  const runBtn = h('button', { class: 'btn primary', onclick: () => exec('run') });
  const checkBtn = canCheck(lang) ? h('button', { class: 'btn', onclick: () => exec('check') }, '✔ 文法チェックだけ') : null;
  const clearBtn = h('button', { class: 'btn', onclick: () => (editor.setText(''), editor.focus?.()) }, '🗑 全部消す');
  const noteInput = h('input', { type: 'text', id: 'note', placeholder: 'やりたいこと・困っていること(1行でOK。なくてもいい)', autocomplete: 'off', oninput: () => updatePreview() });
  const askBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Claudeへのお願い' });
  const resChk = h('input', { type: 'checkbox', id: 'withres', checked: true, onchange: () => ((withResult = resChk.checked), updatePreview()) });
  const preview = h('pre', { class: 'preview', 'aria-label': 'Claudeに送る文章のプレビュー' });
  const tokenInfo = h('span', { class: 'tok' });
  const copyBtn = h('button', { class: 'btn primary', onclick: copyMessage }, '📋 Claudeに送る用にコピー');
  const snipName = h('input', { type: 'text', id: 'snipname', placeholder: '名前(例: じゃんけん)', autocomplete: 'off', maxlength: '30' });
  const snipList = h('div', { class: 'snips' });

  const pyLoading = () => lang === 'python' && getPythonStatus() === 'loading';
  function refreshButtons() {
    runBtn.replaceChildren();
    runBtn.disabled = !!busy || (lang === 'kotlin' && !navigator.onLine);
    if (busy === 'run') runBtn.append(h('span', { class: 'spin' }), pyLoading() ? 'Python を準備中…(初回だけ数秒)' : '実行中…');
    else runBtn.append(lang === 'kotlin' ? (navigator.onLine ? '▶ ネットで実行' : 'オフラインでは実行できないよ') : '▶ 実行');
    if (checkBtn) checkBtn.disabled = !!busy;
  }

  function refreshResult() {
    resultHost.replaceChildren();
    if (!result) {
      resultHost.append(h('div', { class: 'panel' }, h('div', { class: 'panel-h' }, h('span', null, '結果')), h('pre', { class: 'result placeholder' }, '▶ 実行すると、結果とエラーのチェックがここに出るよ')));
      return;
    }
    if (diag) resultHost.append(verdictCard(diag));
    resultHost.append(
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'panel-h' }, h('span', null, '出力'), h('span', { class: result.failed ? 'rh-err' : 'rh-ok' }, `${result.failed ? 'エラー' : '成功'} · ${Math.round(result.ms)}ms`)),
        h('pre', { class: `result${result.failed ? ' err' : ''}` }, result.text || '(出力なし)'),
      ),
    );
  }

  function message(): string {
    return buildMessage({ lang, code: editor.getText(), note: noteInput.value, ask, withResult, result: result ?? undefined, diagnosis: diag ?? undefined });
  }
  function updatePreview() {
    const m = message();
    preview.textContent = m;
    tokenInfo.textContent = `約 ${estimateTokens(m)} トークン`;
  }
  async function copyMessage() {
    const ok = await copyText(message());
    toast(ok ? 'コピーしたよ。Claudeに貼りつけてね' : 'コピーできなかったよ。上の文章を長押しで選んでコピーしてね');
  }

  function renderAsk() {
    askBox.replaceChildren(
      ...(Object.keys(ASK_LABEL) as Ask[]).map((a) =>
        h(
          'button',
          {
            class: 'chip',
            'aria-pressed': String(a === ask),
            onclick: () => {
              ask = a;
              store.set('ask', a);
              renderAsk();
              updatePreview();
            },
          },
          ASK_LABEL[a],
        ),
      ),
    );
  }

  async function exec(mode: 'run' | 'check') {
    if (busy) return;
    busy = mode;
    refreshButtons();
    try {
      result = mode === 'run' ? await run(lang, editor.getText()) : await check(lang, editor.getText());
      diag = diagnose(lang, result.text, result.failed, result.line ? [result.line] : []);
      editor.markLines(diag.lines);
    } finally {
      busy = null;
      refreshButtons();
      refreshResult();
      updatePreview();
      resultHost.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function renderSnippets() {
    const list = loadSnippets();
    snipList.replaceChildren(
      ...(list.length
        ? list.map((s) =>
            h(
              'div',
              { class: 'snip' },
              h('button', { class: 'snip-open', onclick: () => (s.lang === lang ? (editor.setText(s.code), toast(`「${s.name}」を開いたよ`)) : (store.set(`draft:${s.lang}`, s.code), go(`#/edit?l=${s.lang}`, true))) }, h('b', null, s.name), h('span', { class: `badge lang-${s.lang}` }, LANG_LABEL[s.lang])),
              h('button', { class: 'btn small', 'aria-label': `${s.name} を消す`, onclick: () => (saveSnippets(loadSnippets().filter((x) => x.id !== s.id)), renderSnippets()) }, '消す'),
            ),
          )
        : [h('p', { class: 'hint' }, 'まだ何も保存してないよ。コードを書いて、名前をつけて保存しよう。')]),
    );
  }
  function saveSnippet() {
    const name = snipName.value.trim() || `${LANG_LABEL[lang]} ${new Date().toLocaleDateString('ja-JP')}`;
    const list = loadSnippets();
    list.unshift({ id: String(Date.now()), name, lang, code: editor.getText(), at: Date.now() });
    saveSnippets(list);
    snipName.value = '';
    renderSnippets();
    toast(`「${name}」を保存したよ`);
  }

  // ---- 候補・意味・入力バー ----
  const meaningHost = h('div', { class: 'meaning-body', 'aria-live': 'polite' });
  function showMeaning(info: WordInfo | null) {
    meaningHost.replaceChildren();
    if (!info) {
      meaningHost.append(h('p', { class: 'hint' }, 'コードの中の言葉(for や print など)にカーソルを置くと、意味がここに出るよ。何か打つと、関連するコードが候補に出る。「くりかえし」のような日本語でもOK。'));
      return;
    }
    if (!info.entry) {
      meaningHost.append(h('p', { class: 'hint' }, h('code', null, info.word), ' は辞書にない言葉だよ(自分で作った名前かも)。'));
      return;
    }
    const e = info.entry;
    meaningHost.append(
      h('div', { class: 'm-head' }, h('code', { class: 'm-word' }, info.word), h('span', { class: 'm-label' }, e.l)),
      h('p', { class: 'm-text' }, e.m),
      h('pre', { class: 'm-example' }, expandDefault(e.t, e.raw)),
      h('button', { class: 'btn small', onpointerdown: (ev: Event) => ev.preventDefault(), onclick: () => editor.insertEntry(e) }, 'この例をカーソルの位置に入れる'),
    );
  }
  const keep = (ev: Event) => ev.preventDefault(); // ボタンを押しても、エディタからキーボードが消えないようにする
  const indentText = lang === 'javascript' ? '  ' : '    ';
  const keyBar = h(
    'div',
    { class: 'keybar', role: 'toolbar', 'aria-label': '入力バー' },
    h('button', { class: 'key main', onpointerdown: keep, onclick: () => editor.showSuggestions() }, '💡 候補'),
    h('button', { class: 'key main', onpointerdown: keep, onclick: () => editor.nextField() }, '⇥ 次の穴'),
    h('button', { class: 'key', onpointerdown: keep, onclick: () => editor.insert(indentText) }, '字下げ'),
    ...KEYS[lang].map((k) => h('button', { class: 'key', onpointerdown: keep, onclick: () => editor.insert(k.text, k.back ?? 0) }, k.label)),
  );

  const editor: Editor = createEditor(
    editorHost,
    initial,
    lang,
    () => {
      store.set(draftKey, editor.getText()); // 書いたものは自動で残る
      updatePreview();
    },
    { onWord: showMeaning },
  );
  showMeaning(null);
  onDispose(() => editor.destroy());
  if (lang === 'python') {
    preloadPython().catch(() => {});
    onDispose(onPythonStatus(() => refreshButtons()));
  }
  const onNet = () => refreshButtons();
  window.addEventListener('online', onNet);
  window.addEventListener('offline', onNet);
  onDispose(() => {
    window.removeEventListener('online', onNet);
    window.removeEventListener('offline', onNet);
  });

  renderAsk();
  renderSnippets();
  refreshButtons();
  refreshResult();
  updatePreview();

  app.append(
    h('header', { class: 'top' }, h('div', { class: 'wrap' }, h('div', { class: 'brand' }, h('button', { class: 'back', onclick: () => go('#/') }, '‹ 辞典にもどる'), netBadge()))),
    h(
      'main',
      { class: `wrap lang-${lang}` },
      h('h2', { class: 't-title' }, 'エディタ'),
      h('p', { class: 't-sum' }, '自分のコードを書いて、動かして、エラーをチェックしよう。書いたものは自動で残るよ。'),
      h(
        'div',
        { class: 'tabs', role: 'tablist' },
        ...LANG_ORDER.map((l) => h('button', { class: `tab lang-${l}`, role: 'tab', 'aria-selected': String(l === lang), onclick: () => go(`#/edit?l=${l}`, true) }, LANG_LABEL[l])),
      ),
      h('section', { class: 'panel', style: 'margin-top:12px' }, h('div', { class: 'panel-h' }, h('span', null, EXT[lang]), h('button', { class: 'btn small', onclick: () => (editor.setText(STARTER[lang])) }, 'ひな形を入れる')), editorHost, keyBar, h('div', { class: 'actions' }, runBtn, checkBtn, clearBtn)),
      h('section', { class: 'panel meaning' }, h('div', { class: 'panel-h' }, h('span', null, '💡 意味と候補')), meaningHost),
      lang === 'kotlin' ? h('div', { class: 'callout warn' }, 'Kotlin は、ネットにつないで公式の Kotlin Playground で実行するよ。') : null,
      lang === 'c' ? h('div', { class: 'callout warn' }, 'C は、スマホの中の小さな C エンジン(picoc)で動かすよ。エラーの文章は gcc とちがうことがあるよ。') : null,
      resultHost,
      h(
        'section',
        { class: 'panel send' },
        h('div', { class: 'panel-h' }, h('span', null, 'Claudeに送る(トークン節約)'), tokenInfo),
        h(
          'div',
          { class: 'send-body' },
          h('label', { for: 'note', class: 'lbl' }, 'ひとこと'),
          noteInput,
          h('div', { class: 'lbl' }, 'お願い'),
          askBox,
          h('label', { class: 'chk', for: 'withres' }, resChk, '実行結果もつける(長い出力は短くする)'),
          preview,
          copyBtn,
        ),
      ),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-h' }, h('span', null, '保存したコード')),
        h('div', { class: 'send-body' }, h('div', { class: 'row' }, snipName, h('button', { class: 'btn', onclick: saveSnippet }, '💾 保存')), snipList),
      ),
    ),
  );
}
