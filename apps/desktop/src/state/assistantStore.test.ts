import { beforeEach, describe, expect, it } from 'vitest';
import type { DiffHunk, ProposedEdit } from '@yuemi/protocol';

import { useAssistantStore } from './assistantStore';
import { useProjectStore } from './projectStore';

function hunk(oldStart: number, oldCount: number): DiffHunk {
  return {
    oldStart,
    oldCount,
    newStart: oldStart,
    newCount: oldCount,
    lines: [],
    changes: [{ oldStart, oldCount, newLines: [`new ${oldStart}\n`] }],
  };
}

function edit(hunks: DiffHunk[]): ProposedEdit {
  return {
    id: 'edit-1',
    path: 'content/a.md',
    kind: 'replace',
    oldText: 'one\ntwo\nthree\n',
    newText: 'one\nnew 2\nthree\n',
    hunks,
  };
}

describe('useAssistantStore', () => {
  beforeEach(() => {
    useAssistantStore.getState().setPending([]);
    useAssistantStore.getState().setToolCalls([]);
    useAssistantStore.getState().setError(null);
    useProjectStore.getState().newProject();
  });

  it('starts with nothing pending', () => {
    const state = useAssistantStore.getState();

    expect(state.pending).toEqual([]);
    expect(state.toolCalls).toEqual([]);
    expect(state.status).toBe('idle');
  });

  it('holds the changes the assistant proposed', () => {
    useAssistantStore.getState().setPending([edit([hunk(2, 1)])]);

    const state = useAssistantStore.getState();
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0].decisions).toEqual(['pending']);
  });

  it('records the decision about a hunk', () => {
    useAssistantStore.getState().setPending([edit([hunk(2, 1)])]);
    useAssistantStore.getState().acceptHunk('edit-1', 0);

    expect(useAssistantStore.getState().pending[0].decisions).toEqual(['accepted']);
  });

  it('records a rejection too', () => {
    useAssistantStore.getState().setPending([edit([hunk(2, 1)])]);
    useAssistantStore.getState().rejectHunk('edit-1', 0);

    expect(useAssistantStore.getState().pending[0].decisions).toEqual(['rejected']);
  });

  it('accepts every hunk of a change at once', () => {
    useAssistantStore.getState().setPending([edit([hunk(2, 1), hunk(3, 1)])]);
    useAssistantStore.getState().acceptEdit('edit-1');

    expect(useAssistantStore.getState().pending[0].decisions).toEqual([
      'accepted',
      'accepted',
    ]);
  });

  it('rejects a change entirely', () => {
    useAssistantStore.getState().setPending([edit([hunk(2, 1)])]);
    useAssistantStore.getState().rejectEdit('edit-1');

    expect(useAssistantStore.getState().pending[0].rejected).toBe(true);
  });

  it('collects only the changes that were accepted', () => {
    useAssistantStore.getState().setPending([edit([hunk(2, 1), hunk(3, 1)])]);
    useAssistantStore.getState().acceptHunk('edit-1', 0);

    const changes = useAssistantStore.getState().collectAccepted();

    expect(Object.keys(changes)).toEqual(['content/a.md']);
    expect(changes['content/a.md']).toBe('one\nnew 2\nthree\n');
  });

  it('collects nothing when nothing was accepted', () => {
    useAssistantStore.getState().setPending([edit([hunk(2, 1)])]);

    expect(useAssistantStore.getState().collectAccepted()).toEqual({});
  });

  it('collects nothing for a rejected change', () => {
    useAssistantStore.getState().setPending([edit([hunk(2, 1)])]);
    useAssistantStore.getState().rejectEdit('edit-1');

    expect(useAssistantStore.getState().collectAccepted()).toEqual({});
  });

  it('puts the accepted changes into the project', () => {
    useProjectStore.getState().addContentFile('content/a.md', 'one\ntwo\nthree\n');
    useAssistantStore.getState().setPending([edit([hunk(2, 1)])]);
    useAssistantStore.getState().acceptEdit('edit-1');

    useAssistantStore.getState().applyAccepted();

    expect(useProjectStore.getState().files['content/a.md']).toBe(
      'one\nnew 2\nthree\n',
    );
  });

  it('makes the whole session one undoable action', () => {
    useProjectStore.getState().addContentFile('content/a.md', 'one\ntwo\nthree\n');
    useAssistantStore.getState().setPending([edit([hunk(2, 1)])]);
    useAssistantStore.getState().acceptEdit('edit-1');
    useAssistantStore.getState().applyAccepted();

    useProjectStore.getState().undo();

    expect(useProjectStore.getState().files['content/a.md']).toBe(
      'one\ntwo\nthree\n',
    );
  });

  it('does not put the same change in twice', () => {
    useProjectStore.getState().addContentFile('content/a.md', 'one\ntwo\nthree\n');
    useAssistantStore.getState().setPending([edit([hunk(2, 1)])]);
    useAssistantStore.getState().acceptEdit('edit-1');

    useAssistantStore.getState().applyAccepted();
    useAssistantStore.getState().applyAccepted();

    expect(useProjectStore.getState().files['content/a.md']).toBe(
      'one\nnew 2\nthree\n',
    );
  });

  it('keeps a change that still needs a decision', () => {
    useAssistantStore.getState().setPending([edit([hunk(2, 1), hunk(3, 1)])]);
    useAssistantStore.getState().acceptHunk('edit-1', 0);

    useAssistantStore.getState().clearAnswered();

    expect(useAssistantStore.getState().pending).toHaveLength(1);
  });

  it('drops a change every hunk of which was decided', () => {
    useAssistantStore.getState().setPending([edit([hunk(2, 1), hunk(3, 1)])]);
    useAssistantStore.getState().acceptEdit('edit-1');

    useAssistantStore.getState().clearAnswered();

    expect(useAssistantStore.getState().pending).toHaveLength(0);
  });

  it('drops a change that was rejected', () => {
    useAssistantStore.getState().setPending([edit([hunk(2, 1)])]);
    useAssistantStore.getState().rejectEdit('edit-1');

    useAssistantStore.getState().clearAnswered();

    expect(useAssistantStore.getState().pending).toHaveLength(0);
  });
});
