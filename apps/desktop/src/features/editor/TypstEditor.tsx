import { useEffect, useRef } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';

import { typstLanguage } from '../../lib/codemirror/typst';

export interface TypstEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Called after the user pauses, so one undo step covers one editing burst. */
  onCommit?: () => void;
  /**
   * Called with the offset of the cursor whenever it moves.
   *
   * The offset is where the cursor sits in the text, counted from the start
   * of the file, which is what the page the cursor is on is worked out from.
   */
  onCursorChange?: (offset: number) => void;
  /**
   * A request to put the cursor at an offset.
   *
   * The request is carried out once. The id tells a new request from the
   * same request seen again after a render, so the cursor is not moved away
   * from where the user put it.
   */
  cursorRequest?: { offset: number; id: number } | null;
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

export function TypstEditor({
  value,
  onChange,
  onCommit,
  onCursorChange,
  cursorRequest = null,
  readOnly = false,
}: TypstEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);
  const onCursorChangeRef = useRef(onCursorChange);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The id of the last cursor request that was carried out.
   *
   * The request is only carried out once, so the cursor is not moved away
   * from where the user put it the next time the file is rendered.
   */
  const handledCursorRequest = useRef<number | null>(null);

  // The change handler is kept in a ref so the CodeMirror listener does not
  // have to be rebuilt on every render, which would tear down the editor.
  // The ref is written after the render rather than during it, because a ref
  // that is written during the render is read by a later render before the
  // write is guaranteed to have happened.
  useEffect(() => {
    onChangeRef.current = onChange;
    onCommitRef.current = onCommit;
    onCursorChangeRef.current = onCursorChange;
  });

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
          typstLanguage,
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

            // The cursor is reported whenever it moves, and after a change
            // as well, because a change moves it.
            if (update.selectionSet || update.docChanged) {
              onCursorChangeRef.current?.(update.state.selection.main.head);
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

  // Put the cursor where the app asked for it.
  //
  // The request is carried out once. The same request is seen again after
  // every render, and moving the cursor every time would take it away from
  // where the user put it.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !cursorRequest) {
      return;
    }

    if (handledCursorRequest.current === cursorRequest.id) {
      return;
    }

    handledCursorRequest.current = cursorRequest.id;

    const offset = Math.max(0, Math.min(cursorRequest.offset, view.state.doc.length));
    view.dispatch({ selection: { anchor: offset } });
    view.focus();
  }, [cursorRequest]);

  return <div ref={hostRef} className="editor-host" data-testid="typst-editor" />;
}
