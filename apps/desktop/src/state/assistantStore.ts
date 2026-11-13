import { create } from 'zustand';
import {
  applyEdit,
  type AiToolResult,
  type DiffHunk,
  type ProposedEdit,
} from '@yuemi/protocol';

import { useProjectStore } from './projectStore';

export type AssistantStatus = 'idle' | 'running' | 'error';

/**
 * What the user decided about one run of changes.
 */
export type HunkDecision = 'pending' | 'accepted' | 'rejected';

/**
 * A change the assistant proposed, together with what the user decided
 * about it.
 */
export interface PendingEdit {
  edit: ProposedEdit;
  /** The decision for each hunk, in the order the hunks appear. */
  decisions: HunkDecision[];
  /** Whether the user rejected the whole change. */
  rejected: boolean;
}

export interface AssistantState {
  /** The changes the assistant has proposed and the user has not answered. */
  pending: PendingEdit[];
  /** What the tools did in the last session. */
  toolCalls: AiToolResult[];
  status: AssistantStatus;
  error: string | null;

  setPending: (edits: ProposedEdit[]) => void;
  setToolCalls: (calls: AiToolResult[]) => void;
  setRunning: (running: boolean) => void;
  setError: (error: string | null) => void;

  /** Accepts one hunk of a change. */
  acceptHunk: (editId: string, hunkIndex: number) => void;
  /** Rejects one hunk of a change. */
  rejectHunk: (editId: string, hunkIndex: number) => void;
  /** Accepts every hunk of a change. */
  acceptEdit: (editId: string) => void;
  /** Rejects a change entirely. */
  rejectEdit: (editId: string) => void;
  /** Accepts every change. */
  acceptAll: () => void;
  /** Rejects every change. */
  rejectAll: () => void;

  /** The changes that have been accepted and not yet applied. */
  collectAccepted: () => Record<string, string>;
  /** Puts the accepted changes into the project. */
  applyAccepted: () => void;
  /** Removes the changes that have been answered. */
  clearAnswered: () => void;
}

/**
 * The hunks of a change that the user accepted.
 */
function acceptedHunks(entry: PendingEdit): DiffHunk[] {
  return entry.edit.hunks.filter(
    (_hunk, index) => entry.decisions[index] === 'accepted',
  );
}

/**
 * Whether every hunk of a change has been decided.
 */
function isAnswered(entry: PendingEdit): boolean {
  return entry.decisions.every((decision) => decision !== 'pending');
}

export const useAssistantStore = create<AssistantState>((set, get) => ({
  pending: [],
  toolCalls: [],
  status: 'idle',
  error: null,

  setPending: (edits) =>
    set({
      pending: edits.map((edit) => ({
        edit,
        decisions: edit.hunks.map(() => 'pending' as HunkDecision),
        rejected: false,
      })),
    }),

  setToolCalls: (calls) => set({ toolCalls: calls }),

  setRunning: (running) =>
    set((state) => ({
      status: running ? 'running' : 'idle',
      error: running ? null : state.error,
    })),

  setError: (error) => set({ error, status: error ? 'error' : 'idle' }),

  acceptHunk: (editId, hunkIndex) =>
    set((state) => ({
      pending: state.pending.map((entry) =>
        entry.edit.id !== editId
          ? entry
          : {
              ...entry,
              decisions: entry.decisions.map((decision, index) =>
                index === hunkIndex ? 'accepted' : decision,
              ),
            },
      ),
    })),

  rejectHunk: (editId, hunkIndex) =>
    set((state) => ({
      pending: state.pending.map((entry) =>
        entry.edit.id !== editId
          ? entry
          : {
              ...entry,
              decisions: entry.decisions.map((decision, index) =>
                index === hunkIndex ? 'rejected' : decision,
              ),
            },
      ),
    })),

  acceptEdit: (editId) =>
    set((state) => ({
      pending: state.pending.map((entry) =>
        entry.edit.id !== editId
          ? entry
          : {
              ...entry,
              decisions: entry.edit.hunks.map(() => 'accepted' as HunkDecision),
            },
      ),
    })),

  rejectEdit: (editId) =>
    set((state) => ({
      pending: state.pending.map((entry) =>
        entry.edit.id !== editId ? entry : { ...entry, rejected: true },
      ),
    })),

  acceptAll: () =>
    set((state) => ({
      pending: state.pending.map((entry) => ({
        ...entry,
        decisions: entry.edit.hunks.map(() => 'accepted' as HunkDecision),
      })),
    })),

  rejectAll: () =>
    set((state) => ({
      pending: state.pending.map((entry) => ({
        ...entry,
        decisions: entry.edit.hunks.map(() => 'rejected' as HunkDecision),
      })),
    })),

  collectAccepted: () => {
    const changes: Record<string, string> = {};

    for (const entry of get().pending) {
      if (entry.rejected) {
        continue;
      }
      const hunks = acceptedHunks(entry);
      if (hunks.length === 0) {
        continue;
      }
      changes[entry.edit.path] = applyEdit(entry.edit, hunks);
    }

    return changes;
  },

  applyAccepted: () => {
    const changes = get().collectAccepted();
    if (Object.keys(changes).length === 0) {
      return;
    }
    // The whole session is one undoable action, so the changes are put into
    // the project together rather than one at a time.
    useProjectStore.getState().applyFileEdits(changes);

    // The changes that were applied are taken off the list, so applying
    // again does not put the same change in twice.
    set((state) => ({
      pending: state.pending.map((entry) => ({
        ...entry,
        decisions: entry.decisions.map(() => 'pending' as HunkDecision),
      })),
    }));
  },

  clearAnswered: () =>
    set((state) => ({
      // A change is answered once it has been rejected or once every one of
      // its hunks has been decided. A change where only some hunks were
      // decided stays, because the rest still needs a decision.
      pending: state.pending.filter((entry) => !entry.rejected && !isAnswered(entry)),
    })),
}));
