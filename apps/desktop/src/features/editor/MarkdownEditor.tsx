import { useEffect, useRef } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Called after the user pauses, so one undo step covers one editing burst. */
  onCommit?: () => void;
  readOnly?: boolean;
}

const highlightStyle = HighlightStyle.define([
  { tag: t.heading, fontWeight: 'bold', fontSize: '1.15em' },
  { tag: t.link, color: '#2563eb', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.monospace, fontFamily: 'ui-monospace, monospace' },
  { tag: t.comment, color: '#6b7280', fontStyle: 'italic' },
  { tag: t.quote, color: '#4b5563' },
  { tag: t.list, color: '#7c3aed' },
]);

const extensions: Extension[] = [
  lineNumbers(),
  history(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  markdown({ base: markdownLanguage, codeLanguages: languages }),
  syntaxHighlighting(highlightStyle),
  keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
  EditorView.lineWrapping,
  EditorView.theme({
    '&': { height: '100%', fontSize: '14px' },
    '.cm-scroller': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      lineHeight: '1.6',
    },
    '.cm-content': { padding: '12px 0' },
    '&.cm-focused': { outline: 'none' },
  }),
];

export function MarkdownEditor({
  value,
  onChange,
  onCommit,
  readOnly = false,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartment = useRef(new Compartment());
  // Kept in a ref so the change handler does not need to be rebuilt on every
  // render, which would tear down the editor.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A pause in typing ends the current editing burst and records an undo
  // point, so one undo step covers one burst rather than one keystroke.
  useEffect(() => {
    return () => {
      if (commitTimer.current) {
        clearTimeout(commitTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          ...extensions,
          readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
              if (commitTimer.current) {
                clearTimeout(commitTimer.current);
              }
              commitTimer.current = setTimeout(() => {
                commitTimer.current = null;
                onCommitRef.current?.();
              }, 600);
            }
          }),
        ],
      }),
      parent: host,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once; the document is synced by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push external changes (undo, file switch) into the editor without
  // echoing them straight back out.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const current = view.state.doc.toString();
    if (current === value) {
      return;
    }
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: { anchor: Math.min(view.state.selection.main.anchor, value.length) },
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(
        EditorState.readOnly.of(readOnly),
      ),
    });
  }, [readOnly]);

  return <div ref={hostRef} className="editor-host" data-testid="markdown-editor" />;
}
