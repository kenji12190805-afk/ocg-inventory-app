import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, hoverTooltip, Decoration, WidgetType, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, bracketMatching, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, completionKeymap, nextSnippetField, snippet, startCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import { kotlin } from '@codemirror/legacy-modes/mode/clike';
import type { Lang } from './runners/types';
import { suggest, lookupWord, expandDefault, shortMeaning, type Entry } from './dict/index.ts';
import { explainLine, COMMENT_PREFIX } from './explain.ts';

const langExt = (lang: Lang): Extension => {
  switch (lang) {
    case 'python':
      return python();
    case 'javascript':
      return javascript();
    case 'c':
      return cpp();
    case 'kotlin':
      return StreamLanguage.define(kotlin);
  }
};

// 色は style.css のCSS変数(--syn-*)で決めるので、ダークモードにも自動で対応する
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)], color: 'var(--syn-func)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syn-type)' },
  { tag: [t.meta, t.processingInstruction], color: 'var(--syn-meta)' },
]);

const theme = EditorView.theme({
  '&': { fontSize: '16px', backgroundColor: 'transparent', color: 'var(--code-fg)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '10px 0' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--code-muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--code-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--code-fg)' },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '2px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--code-sel) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-errorLine': { backgroundColor: 'var(--danger-bg)', boxShadow: 'inset 3px 0 0 var(--danger)' },
});

const setErrorLines = StateEffect.define<number[]>();
const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setErrorLines)) {
        const lines = [...new Set(e.value)].filter((n) => n >= 1 && n <= tr.state.doc.lines).sort((a, b) => a - b);
        return Decoration.set(lines.map((n) => Decoration.line({ class: 'cm-errorLine' }).range(tr.state.doc.line(n).from)));
      }
    }
    return tr.docChanged ? Decoration.none : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---------- 行の下に「意味」をコメントのように出す ----------

const setExplainOn = StateEffect.define<boolean>();

class ExplainWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly indent: number,
  ) {
    super();
  }
  eq(o: ExplainWidget) {
    return o.text === this.text && o.indent === this.indent;
  }
  toDOM() {
    const d = document.createElement('div');
    d.className = 'cm-explain';
    d.style.paddingLeft = `${this.indent}ch`;
    d.textContent = this.text;
    return d;
  }
  ignoreEvent() {
    return true;
  }
}

function buildExplain(state: EditorState, lang: Lang): DecorationSet {
  const ranges = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const text = explainLine(lang, line.text);
    if (!text) continue;
    const comment = COMMENT_PREFIX[lang] + text;
    // すでに同じコメントが下に書き込まれている行は、重ねて出さない
    if (n < state.doc.lines && state.doc.line(n + 1).text.trim() === comment) continue;
    const indent = /^\s*/.exec(line.text)![0].length;
    ranges.push(Decoration.widget({ widget: new ExplainWidget(comment, indent), block: true, side: 1 }).range(line.to));
  }
  return Decoration.set(ranges);
}

const explainField = (lang: Lang, initial: boolean) =>
  StateField.define<{ on: boolean; deco: DecorationSet }>({
    create: (state) => ({ on: initial, deco: initial ? buildExplain(state, lang) : Decoration.none }),
    update(v, tr) {
      let on = v.on;
      for (const e of tr.effects) if (e.is(setExplainOn)) on = e.value;
      if (!on) return on === v.on ? v : { on, deco: Decoration.none };
      if (tr.docChanged || on !== v.on) return { on, deco: buildExplain(tr.state, lang) };
      return v;
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });

// ---------- 候補と意味(入力の手助け) ----------

/** 意味と、入る形(例)を見せる小さな表示 */
export function entryDom(e: Entry): HTMLElement {
  const box = document.createElement('div');
  box.className = 'cm-assist-info';
  const m = document.createElement('div');
  m.className = 'cm-assist-m';
  m.textContent = e.m;
  const pre = document.createElement('pre');
  pre.textContent = expandDefault(e.t, e.raw);
  box.append(m, pre);
  return box;
}

/** nums.app のように、前に持ち主(nums)があるとき、ひな形の最初の穴を持ち主に置きかえる */
function withReceiver(e: Entry, receiver: string): string {
  if (!receiver || !e.l.startsWith('.') || e.raw) return e.t;
  return e.t.replace(/\$\{1(?::[^}]*)?\}/g, receiver);
}

function toCompletion(e: Entry, receiver: string): Completion {
  const tpl = withReceiver(e, receiver);
  return {
    label: e.l,
    detail: shortMeaning(e.m),
    type: 'keyword',
    info: () => entryDom(e),
    apply: e.raw ? tpl : snippet(tpl),
  };
}

function completionSource(lang: Lang) {
  return (ctx: CompletionContext): CompletionResult | null => {
    // 英数字・日本語・. # の続きを、打っている言葉として拾う
    const w = ctx.matchBefore(/[\w.#぀-ヿ㐀-鿿ｦ-ﾟ]+/);
    if (!w && !ctx.explicit) return null;
    const text = w?.text ?? '';
    const entries = suggest(lang, text, ctx.explicit);
    if (!entries.length) return null;
    const dot = text.lastIndexOf('.');
    const receiver = dot > 0 ? text.slice(0, dot) : '';
    return { from: w ? w.from : ctx.pos, options: entries.map((e) => toCompletion(e, receiver)), filter: false };
  };
}

export interface WordInfo {
  /** カーソルのところの言葉 */
  word: string;
  /** 辞書にあれば、その意味。なければ null(自分で作った名前など) */
  entry: Entry | null;
}
export interface AssistOptions {
  /** カーソルの位置の言葉が変わるたびに呼ばれる */
  onWord?: (info: WordInfo | null) => void;
  /** 行の下に意味(コメント風)を出すか。あとから setExplain で切り替えられる */
  explain?: boolean;
}

export interface Editor {
  /** エラーが出た行(1始まり)に色をつける。コードを書きかえると消える */
  markLines(lines: number[]): void;
  getText(): string;
  setText(text: string): void;
  focus?(): void;
  /** カーソルの位置に文字を入れる。back を指定すると、その文字数だけ左にカーソルを戻す(例: "()" のあと back=1) */
  insert(text: string, back?: number): void;
  /** 辞書の項目をひな形として入れる(穴つき) */
  insertEntry(e: Entry): void;
  /** ひな形の「次の穴」へ進む */
  nextField(): void;
  /** 候補を出す(何も打ってなくても、よく使うものを出す) */
  showSuggestions(): void;
  /** 行の下に意味を出す/消す(コードは変わらない) */
  setExplain(on: boolean): void;
  /** 意味を、本物のコメントとしてコードに書き込む。書き込んだ行数を返す */
  insertComments(): number;
  /** 1つ前に戻す */
  undo(): void;
  destroy(): void;
}

export function createEditor(parent: HTMLElement, text: string, lang: Lang, onChange: () => void, assist?: AssistOptions): Editor {
  const assistExt: Extension[] = assist
    ? [
        autocompletion({
          override: [completionSource(lang)],
          icons: false,
          selectOnOpen: false, // Enter で勝手に候補が入らないように。候補はタップか、↑↓のあとの Enter で選ぶ
          maxRenderedOptions: 10,
          tooltipClass: () => 'cm-assist',
        }),
        keymap.of(completionKeymap),
        hoverTooltip(
          (view, pos) => {
            const w = view.state.wordAt(pos);
            if (!w) return null;
            const e = lookupWord(lang, view.state.sliceDoc(w.from, w.to));
            return e ? { pos: w.from, end: w.to, above: true, create: () => ({ dom: entryDom(e) }) } : null;
          },
          { hideOnChange: true },
        ),
      ]
    : [];

  const report = (view: EditorView) => {
    if (!assist?.onWord) return;
    const head = view.state.selection.main.head;
    const w = view.state.wordAt(head) ?? (head > 0 ? view.state.wordAt(head - 1) : null);
    if (!w) return assist.onWord(null);
    const word = view.state.sliceDoc(w.from, w.to);
    assist.onWord({ word, entry: lookupWord(lang, word) });
  };

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        EditorView.lineWrapping,
        history(),
        drawSelection(),
        highlightActiveLine(),
        errorLineField,
        ...(assist ? [explainField(lang, assist.explain ?? false)] : []),
        bracketMatching(),
        indentUnit.of(lang === 'javascript' ? '  ' : '    '),
        ...assistExt,
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        langExt(lang),
        syntaxHighlighting(highlight),
        theme,
        EditorView.contentAttributes.of({ 'aria-label': `${lang} のコード(編集できます)`, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange();
          if (u.selectionSet || u.docChanged) report(u.view);
        }),
      ],
    }),
  });
  return {
    focus: () => view.focus(),
    markLines: (lines) => view.dispatch({ effects: setErrorLines.of(lines) }),
    getText: () => view.state.doc.toString(),
    setText: (s) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: s } }),
    insert: (s, back = 0) => {
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: s }, selection: { anchor: from + s.length - back }, scrollIntoView: true });
      view.focus();
    },
    insertEntry: (e) => {
      const { from, to } = view.state.selection.main;
      if (e.raw) view.dispatch({ changes: { from, to, insert: e.t } });
      else snippet(e.t)(view, null, from, to);
      view.focus();
    },
    nextField: () => {
      nextSnippetField(view);
      view.focus();
    },
    showSuggestions: () => {
      view.focus();
      startCompletion(view);
    },
    setExplain: (on) => view.dispatch({ effects: setExplainOn.of(on) }),
    insertComments: () => {
      const doc = view.state.doc;
      const prefix = COMMENT_PREFIX[lang];
      const changes: { from: number; insert: string }[] = [];
      for (let n = 1; n <= doc.lines; n++) {
        const line = doc.line(n);
        const text = explainLine(lang, line.text);
        if (!text) continue;
        const comment = prefix + text;
        // すでに同じコメントが下にあるときは、重ねて入れない
        if (n < doc.lines && doc.line(n + 1).text.trim() === comment) continue;
        const indent = /^\s*/.exec(line.text)![0];
        changes.push({ from: line.to, insert: `\n${indent}${comment}` });
      }
      if (changes.length) view.dispatch({ changes });
      view.focus();
      return changes.length;
    },
    undo: () => {
      undo(view);
      view.focus();
    },
    destroy: () => view.destroy(),
  };
}
