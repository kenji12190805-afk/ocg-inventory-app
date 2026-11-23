import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, Decoration, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, bracketMatching, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import { kotlin } from '@codemirror/legacy-modes/mode/clike';
import type { Lang } from './runners/types';

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

export interface Editor {
  /** エラーが出た行(1始まり)に色をつける。コードを書きかえると消える */
  markLines(lines: number[]): void;
  getText(): string;
  setText(text: string): void;
  focus?(): void;
  destroy(): void;
}

export function createEditor(parent: HTMLElement, text: string, lang: Lang, onChange: () => void): Editor {
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
        bracketMatching(),
        indentUnit.of(lang === 'javascript' ? '  ' : '    '),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        langExt(lang),
        syntaxHighlighting(highlight),
        theme,
        EditorView.contentAttributes.of({ 'aria-label': `${lang} のコード(編集できます)`, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange();
        }),
      ],
    }),
  });
  return {
    focus: () => view.focus(),
    markLines: (lines) => view.dispatch({ effects: setErrorLines.of(lines) }),
    getText: () => view.state.doc.toString(),
    setText: (s) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: s } }),
    destroy: () => view.destroy(),
  };
}
