import { useCallback, useState } from 'react';

import { pageHeading, removePage, splitPages } from '../../lib/pages';
import { useProjectStore } from '../../state/projectStore';

/**
 * A page that was asked to be removed.
 *
 * The page is told apart by the heading it starts with, so the confirmation
 * can say which page is going.
 */
export interface PageRemoval {
  kind: 'page';
  /** The file the page is in. */
  path: string;
  /** The page's position in the file, starting at zero. */
  index: number;
  /** The heading the page starts with, when it has one. */
  title: string | null;
}

/** A file that was asked to be removed. */
export interface FileRemoval {
  kind: 'file';
  /** The path of the file. */
  path: string;
}

/** Something the user asked to have removed, and is being asked about. */
export type PendingRemoval = PageRemoval | FileRemoval;

/**
 * Asking before something is taken away.
 *
 * Nothing is removed until the user confirms it, so the request and the
 * removal are kept apart. The removal itself goes through the store, so it
 * can be undone like any other change.
 */
export function usePageRemoval() {
  const { setFileText, commit, removeContentFile } = useProjectStore();
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);

  /**
   * Asks about a page of a file.
   *
   * The text is read when the request is made, because the confirmation says
   * what the page is called and that is the heading it starts with.
   */
  const requestPageRemoval = useCallback((path: string, index: number) => {
    const text = useProjectStore.getState().files[path] ?? '';
    const span = splitPages(text)[index];

    setPendingRemoval({
      kind: 'page',
      path,
      index,
      title: span ? pageHeading(text, span) : null,
    });
  }, []);

  /**
   * Asks about a whole file.
   */
  const requestFileRemoval = useCallback((path: string) => {
    setPendingRemoval({ kind: 'file', path });
  }, []);

  /**
   * Carries the removal out.
   *
   * A file is taken out of the document, and a page is taken out of the text
   * of its file. Both leave an undo step behind.
   */
  const confirmRemoval = useCallback(() => {
    if (!pendingRemoval) {
      return;
    }

    if (pendingRemoval.kind === 'file') {
      removeContentFile(pendingRemoval.path);
      setPendingRemoval(null);
      return;
    }

    const text = useProjectStore.getState().files[pendingRemoval.path] ?? '';
    setFileText(pendingRemoval.path, removePage(text, pendingRemoval.index));
    commit();
    setPendingRemoval(null);
  }, [commit, pendingRemoval, removeContentFile, setFileText]);

  /**
   * Leaves the document as it was.
   */
  const cancelRemoval = useCallback(() => {
    setPendingRemoval(null);
  }, []);

  return {
    pendingRemoval,
    requestPageRemoval,
    requestFileRemoval,
    confirmRemoval,
    cancelRemoval,
  };
}
