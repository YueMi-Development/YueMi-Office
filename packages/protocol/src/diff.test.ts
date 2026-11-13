import { describe, expect, it } from 'vitest';
import type { DiffChange, DiffHunk, ProposedEdit } from './index';

import {
  applyChanges,
  applyEdit,
  changesOfHunks,
  describeEdit,
  splitLines,
} from './diff';

function change(oldStart: number, oldCount: number, ...newLines: string[]): DiffChange {
  return { oldStart, oldCount, newLines };
}

function hunk(
  oldStart: number,
  oldCount: number,
  newStart: number,
  newCount: number,
  changes: DiffChange[],
): DiffHunk {
  return {
    oldStart,
    oldCount,
    newStart,
    newCount,
    lines: [],
    changes,
  };
}

describe('splitLines', () => {
  it('keeps the newline that ends each line', () => {
    expect(splitLines('one\ntwo\n')).toEqual(['one\n', 'two\n']);
  });

  it('treats an empty file as having no lines', () => {
    expect(splitLines('')).toEqual([]);
  });

  it('leaves the last line open when the file does not end in a newline', () => {
    expect(splitLines('one\ntwo')).toEqual(['one\n', 'two']);
  });

  it('puts the lines back together unchanged', () => {
    const text = 'one\ntwo\nthree';
    expect(splitLines(text).join('')).toBe(text);
  });
});

describe('applyChanges', () => {
  it('replaces a line', () => {
    expect(applyChanges('one\ntwo\n', [change(2, 1, 'TWO\n')])).toBe('one\nTWO\n');
  });

  it('applies several changes', () => {
    const result = applyChanges('one\ntwo\nthree\n', [
      change(1, 1, 'ONE\n'),
      change(3, 1, 'THREE\n'),
    ]);

    expect(result).toBe('ONE\ntwo\nTHREE\n');
  });

  it('adds a line without removing one', () => {
    expect(applyChanges('one\ntwo\n', [change(2, 0, 'new\n')])).toBe('one\nnew\ntwo\n');
  });

  it('removes a line without adding one', () => {
    expect(applyChanges('one\ntwo\nthree\n', [change(2, 1)])).toBe('one\nthree\n');
  });

  it('applies a change that overlaps another only once', () => {
    const result = applyChanges('one\ntwo\nthree\n', [
      change(1, 2, 'ONE\n'),
      change(1, 2, 'ONE\n'),
    ]);

    expect(result).toBe('ONE\nthree\n');
  });
});

describe('changesOfHunks', () => {
  it('collects the changes of every hunk', () => {
    const result = changesOfHunks([
      hunk(1, 1, 1, 1, [change(1, 1, 'a\n')]),
      hunk(5, 1, 5, 1, [change(5, 1, 'b\n')]),
    ]);

    expect(result).toHaveLength(2);
    expect(result[1]?.newLines).toEqual(['b\n']);
  });
});

describe('applyEdit', () => {
  const edit: ProposedEdit = {
    id: 'edit-1',
    path: 'content/a.md',
    kind: 'replace',
    oldText: 'one\ntwo\nthree\n',
    newText: 'one\nTWO\nthree\n',
    hunks: [],
  };

  it('puts an accepted hunk into the file', () => {
    const result = applyEdit(edit, [hunk(2, 1, 2, 1, [change(2, 1, 'TWO\n')])]);

    expect(result).toBe('one\nTWO\nthree\n');
  });

  it('keeps the file as it was when nothing is accepted', () => {
    expect(applyEdit(edit, [])).toBe('one\ntwo\nthree\n');
  });

  it('puts several accepted hunks into the file', () => {
    const twoHunks: ProposedEdit = {
      ...edit,
      oldText: 'one\ntwo\nthree\nfour\n',
      newText: 'one\nTWO\nthree\nFOUR\n',
    };

    const result = applyEdit(twoHunks, [
      hunk(2, 1, 2, 1, [change(2, 1, 'TWO\n')]),
      hunk(4, 1, 4, 1, [change(4, 1, 'FOUR\n')]),
    ]);

    expect(result).toBe('one\nTWO\nthree\nFOUR\n');
  });

  it('leaves out a hunk that was not accepted', () => {
    const twoHunks: ProposedEdit = {
      ...edit,
      oldText: 'one\ntwo\nthree\nfour\n',
      newText: 'one\nTWO\nthree\nFOUR\n',
    };

    const result = applyEdit(twoHunks, [hunk(2, 1, 2, 1, [change(2, 1, 'TWO\n')])]);

    expect(result).toBe('one\nTWO\nthree\nfour\n');
  });
});

describe('describeEdit', () => {
  it('counts the added and removed lines', () => {
    const edit: ProposedEdit = {
      id: 'edit-1',
      path: 'content/a.md',
      kind: 'replace',
      oldText: '',
      newText: '',
      hunks: [
        {
          oldStart: 1,
          oldCount: 2,
          newStart: 1,
          newCount: 1,
          lines: [
            { kind: 'removed', text: 'a' },
            { kind: 'removed', text: 'b' },
            { kind: 'added', text: 'c' },
          ],
          changes: [],
        },
      ],
    };

    expect(describeEdit(edit)).toBe('+1 −2');
  });

  it('says so when there is nothing to change', () => {
    const edit: ProposedEdit = {
      id: 'edit-1',
      path: 'content/a.md',
      kind: 'replace',
      oldText: 'a',
      newText: 'a',
      hunks: [],
    };

    expect(describeEdit(edit)).toBe('No changes');
  });
});
