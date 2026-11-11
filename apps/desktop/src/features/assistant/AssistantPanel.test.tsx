import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ProposedEdit } from '@yuemi/protocol';

import { AssistantPanel } from './AssistantPanel';
import { useAssistantStore } from '../../state/assistantStore';

const edit: ProposedEdit = {
  id: 'edit-1',
  path: 'content/a.md',
  kind: 'replace',
  oldText: 'one\ntwo\n',
  newText: 'one\nTWO\n',
  hunks: [
    {
      oldStart: 1,
      oldCount: 2,
      newStart: 1,
      newCount: 2,
      lines: [
        { kind: 'removed', text: 'one', oldLine: 1 },
        { kind: 'added', text: 'one', newLine: 1 },
        { kind: 'removed', text: 'two', oldLine: 2 },
        { kind: 'added', text: 'TWO', newLine: 2 },
      ],
      changes: [{ oldStart: 1, oldCount: 2, newLines: ['one\n', 'TWO\n'] }],
    },
  ],
};

describe('AssistantPanel', () => {
  beforeEach(() => {
    useAssistantStore.getState().setPending([]);
    useAssistantStore.getState().setToolCalls([]);
    useAssistantStore.getState().setError(null);
  });

  it('shows the script the session is run from', () => {
    render(<AssistantPanel onClose={vi.fn()} />);

    expect(screen.getByLabelText('Session script')).toBeInTheDocument();
  });

  it('shows the changes the session proposed', () => {
    useAssistantStore.getState().setPending([edit]);

    render(<AssistantPanel onClose={vi.fn()} />);

    expect(screen.getByText('content/a.md')).toBeInTheDocument();
    expect(screen.getByText('TWO')).toBeInTheDocument();
  });

  it('shows which tools the session used', () => {
    useAssistantStore.getState().setToolCalls([
      {
        id: '1',
        name: 'list_sections',
        arguments: {},
        ok: true,
      },
    ]);

    render(<AssistantPanel onClose={vi.fn()} />);

    expect(screen.getByText('list_sections')).toBeInTheDocument();
  });

  it('shows why a tool failed', () => {
    useAssistantStore.getState().setToolCalls([
      {
        id: '1',
        name: 'read_section',
        arguments: {},
        ok: false,
        error: 'There is no file at content/nope.md in this project.',
      },
    ]);

    render(<AssistantPanel onClose={vi.fn()} />);

    expect(
      screen.getByText('There is no file at content/nope.md in this project.'),
    ).toBeInTheDocument();
  });

  it('cannot apply anything when no change was accepted', () => {
    useAssistantStore.getState().setPending([edit]);

    render(<AssistantPanel onClose={vi.fn()} />);

    expect(screen.getByText('Apply accepted')).toBeDisabled();
  });

  it('can apply a change once a hunk was accepted', () => {
    useAssistantStore.getState().setPending([edit]);

    render(<AssistantPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Accept change 1'));

    expect(screen.getByText('Apply accepted')).not.toBeDisabled();
  });
});
