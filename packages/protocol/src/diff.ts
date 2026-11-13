import type { DiffChange, DiffHunk, ProposedEdit } from './index';

/**
 * Putting proposed changes into a file.
 *
 * The changes the service sends say which lines they replace, counted from
 * the start of the file, so accepting part of a change is a matter of
 * applying only some of them.
 */

/**
 * Splits text into the lines a change is counted in.
 *
 * Each line keeps the newline that ends it, so joining the lines back
 * together gives the text unchanged. A file that does not end with a
 * newline simply has a last line without one, and an empty file has no
 * lines at all.
 *
 * Only a line feed ends a line, which is what the service counts too.
 */
export function splitLines(text: string): string[] {
  if (!text) {
    return [];
  }

  const parts = text.split('\n');
  const lines = parts.slice(0, -1).map((part) => `${part}\n`);
  const last = parts[parts.length - 1];
  if (last) {
    lines.push(last);
  }
  return lines;
}

/**
 * Puts the given changes into a file and returns the result.
 *
 * Changes that overlap are skipped rather than applied twice, so accepting
 * the same change twice does not corrupt the file.
 */
export function applyChanges(oldText: string, changes: DiffChange[]): string {
  const lines = splitLines(oldText);
  const result: string[] = [];
  let cursor = 0;

  const ordered = [...changes].sort((a, b) => a.oldStart - b.oldStart);

  for (const change of ordered) {
    const start = Math.min(Math.max(change.oldStart - 1, 0), lines.length);
    if (start < cursor) {
      continue;
    }
    result.push(...lines.slice(cursor, start));
    result.push(...change.newLines);
    cursor = start + change.oldCount;
  }

  result.push(...lines.slice(cursor));
  return result.join('');
}

/**
 * The changes of the hunks the user accepted.
 *
 * Accepting a hunk means applying its changes, and accepting the whole
 * change means applying the changes of every hunk.
 */
export function changesOfHunks(hunks: DiffHunk[]): DiffChange[] {
  return hunks.flatMap((hunk) => hunk.changes);
}

/**
 * Applies the accepted hunks of an edit to the file's current text.
 *
 * The changes are counted from the start of the file the edit was made
 * against, so they are applied to the old text of the edit rather than to
 * whatever the file holds now. That keeps the result the same whether the
 * user accepted one hunk or all of them.
 */
export function applyEdit(edit: ProposedEdit, acceptedHunks: DiffHunk[]): string {
  if (acceptedHunks.length === 0) {
    return edit.oldText;
  }
  return applyChanges(edit.oldText, changesOfHunks(acceptedHunks));
}

/**
 * A short description of what an edit changes.
 */
export function describeEdit(edit: ProposedEdit): string {
  const added = edit.hunks.reduce(
    (total, hunk) => total + hunk.lines.filter((line) => line.kind === 'added').length,
    0,
  );
  const removed = edit.hunks.reduce(
    (total, hunk) =>
      total + hunk.lines.filter((line) => line.kind === 'removed').length,
    0,
  );

  if (added === 0 && removed === 0) {
    return 'No changes';
  }
  return `+${added} −${removed}`;
}
