import { useMemo } from 'react';
import { describeEdit, type DiffHunk, type ProposedEdit } from '@yuemi/protocol';

export interface DiffHunkViewProps {
  hunk: DiffHunk;
  /** The index of the hunk within the edit. */
  index: number;
  /** What the user decided about this hunk. */
  decision: 'pending' | 'accepted' | 'rejected';
  onAccept: () => void;
  onReject: () => void;
}

/**
 * One run of changes, with the lines around it.
 *
 * The hunk can be accepted or rejected on its own, so a change that touches
 * two places does not have to be taken or left as a whole.
 */
export function DiffHunkView({
  hunk,
  index,
  decision,
  onAccept,
  onReject,
}: DiffHunkViewProps) {
  return (
    <section className={`diff-hunk diff-hunk-${decision}`}>
      <header className="diff-hunk-header">
        <span className="diff-hunk-range">
          Lines {hunk.oldStart}–{hunk.oldStart + hunk.oldCount - 1}
        </span>
        <span className="diff-hunk-actions">
          <button
            type="button"
            onClick={onAccept}
            disabled={decision === 'accepted'}
            aria-label={`Accept change ${index + 1}`}
          >
            Accept
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={decision === 'rejected'}
            aria-label={`Reject change ${index + 1}`}
          >
            Reject
          </button>
        </span>
      </header>

      <pre className="diff-lines">
        {hunk.lines.map((line, lineIndex) => (
          <div key={lineIndex} className={`diff-line diff-line-${line.kind}`}>
            <span className="diff-line-marker" aria-hidden="true">
              {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
            </span>
            <span className="diff-line-text">{line.text}</span>
          </div>
        ))}
      </pre>
    </section>
  );
}

export interface DiffViewProps {
  edit: ProposedEdit;
  /** What the user decided about each hunk. */
  decisions: ('pending' | 'accepted' | 'rejected')[];
  onAcceptHunk: (index: number) => void;
  onRejectHunk: (index: number) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

/**
 * The difference the assistant proposes for one file.
 */
export function DiffView({
  edit,
  decisions,
  onAcceptHunk,
  onRejectHunk,
  onAcceptAll,
  onRejectAll,
}: DiffViewProps) {
  const summary = useMemo(() => describeEdit(edit), [edit]);

  if (edit.hunks.length === 0) {
    return (
      <section className="diff-edit">
        <header className="diff-edit-header">
          <span className="diff-edit-path">{edit.path}</span>
          <span className="diff-edit-summary">No changes</span>
        </header>
      </section>
    );
  }

  return (
    <section className="diff-edit">
      <header className="diff-edit-header">
        <span className="diff-edit-path">{edit.path}</span>
        <span className="diff-edit-summary">{summary}</span>
        <span className="diff-edit-actions">
          <button type="button" onClick={onAcceptAll}>
            Accept all
          </button>
          <button type="button" onClick={onRejectAll}>
            Reject all
          </button>
        </span>
      </header>

      {edit.hunks.map((hunk, index) => (
        <DiffHunkView
          key={index}
          hunk={hunk}
          index={index}
          decision={decisions[index] ?? 'pending'}
          onAccept={() => onAcceptHunk(index)}
          onReject={() => onRejectHunk(index)}
        />
      ))}
    </section>
  );
}
