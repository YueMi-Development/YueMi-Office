import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DiffHunk, ProposedEdit } from '@yuemi/protocol';

import { DiffView } from './DiffView';

const hunk: DiffHunk = {
  oldStart: 2,
  oldCount: 2,
  newStart: 2,
  newCount: 2,
  lines: [
    { kind: 'context', text: 'one', oldLine: 1, newLine: 1 },
    { kind: 'removed', text: 'two', oldLine: 2 },
    { kind: 'added', text: 'TWO', newLine: 2 },
    { kind: 'context', text: 'three', oldLine: 3, newLine: 3 },
  ],
  changes: [{ oldStart: 2, oldCount: 1, newLines: ['TWO\n'] }],
};

const edit: ProposedEdit = {
  id: 'edit-1',
  path: 'content/a.md',
  kind: 'replace',
  oldText: 'one\ntwo\nthree\n',
  newText: 'one\nTWO\nthree\n',
  hunks: [hunk],
};

describe('DiffView', () => {
  it('shows the file the change is for', () => {
    render(
      <DiffView
        edit={edit}
        decisions={['pending']}
        onAcceptHunk={vi.fn()}
        onRejectHunk={vi.fn()}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
      />,
    );

    expect(screen.getByText('content/a.md')).toBeInTheDocument();
  });

  it('shows the added and the removed lines', () => {
    render(
      <DiffView
        edit={edit}
        decisions={['pending']}
        onAcceptHunk={vi.fn()}
        onRejectHunk={vi.fn()}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
      />,
    );

    expect(screen.getByText('two')).toBeInTheDocument();
    expect(screen.getByText('TWO')).toBeInTheDocument();
  });

  it('calls back when a hunk is accepted', () => {
    const onAcceptHunk = vi.fn();
    render(
      <DiffView
        edit={edit}
        decisions={['pending']}
        onAcceptHunk={onAcceptHunk}
        onRejectHunk={vi.fn()}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
      />,
    );

    screen.getByLabelText('Accept change 1').click();

    expect(onAcceptHunk).toHaveBeenCalledWith(0);
  });

  it('calls back when a hunk is rejected', () => {
    const onRejectHunk = vi.fn();
    render(
      <DiffView
        edit={edit}
        decisions={['pending']}
        onAcceptHunk={vi.fn()}
        onRejectHunk={onRejectHunk}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
      />,
    );

    screen.getByLabelText('Reject change 1').click();

    expect(onRejectHunk).toHaveBeenCalledWith(0);
  });

  it('says so when there is nothing to change', () => {
    render(
      <DiffView
        edit={{ ...edit, hunks: [] }}
        decisions={[]}
        onAcceptHunk={vi.fn()}
        onRejectHunk={vi.fn()}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
      />,
    );

    expect(screen.getByText('No changes')).toBeInTheDocument();
  });
});
