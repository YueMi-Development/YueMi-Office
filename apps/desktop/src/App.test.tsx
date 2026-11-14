import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { PAGE_BREAK } from './lib/pages';
import { useEditorStore } from './state/editorStore';
import { useProjectStore } from './state/projectStore';

/**
 * The whole flow of adding and removing a page.
 *
 * The page toolbar, the editor and the confirmation are separate pieces, so
 * what is checked here is that they work together: that the toolbar says
 * which page the cursor is on, that a page can be added, and that a page is
 * only taken away once the user has confirmed it.
 */

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

const FILE = 'content/report.typ';

describe('App', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(null);

    useEditorStore.getState().setActivePath(null);
    useProjectStore.getState().newProject();
    useProjectStore.getState().addContentFile(FILE, '= One\n\nSome text.\n');
  });

  /**
   * Opens the file, so that the editor and the toolbar are on screen.
   */
  async function openFile() {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'report.typ' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'report.typ' }));
  }

  it('says which page the cursor is on', async () => {
    await openFile();

    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
  });

  it('adds a page to the file that is open', async () => {
    await openFile();

    fireEvent.click(screen.getByRole('button', { name: 'Add page' }));

    await waitFor(() => {
      expect(useProjectStore.getState().files[FILE]).toContain(PAGE_BREAK);
    });
    expect(useProjectStore.getState().files[FILE]).toContain('= One');
  });

  it('cannot remove a page from a file that has only one', async () => {
    await openFile();

    expect(screen.getByRole('button', { name: 'Remove page' })).toBeDisabled();
  });

  it('asks before a page is taken away, and takes nothing until it is confirmed', async () => {
    useProjectStore.getState().setFileText(FILE, `= One\n\n${PAGE_BREAK}\n\n= Two\n`);

    await openFile();

    fireEvent.click(screen.getByRole('button', { name: 'Remove page' }));

    // The confirmation is open, and the file is still as it was.
    expect(screen.getByRole('dialog', { name: 'Remove page' })).toBeInTheDocument();
    expect(useProjectStore.getState().files[FILE]).toContain('= Two');
  });

  it('leaves the file alone when the removal is cancelled', async () => {
    useProjectStore.getState().setFileText(FILE, `= One\n\n${PAGE_BREAK}\n\n= Two\n`);

    await openFile();

    fireEvent.click(screen.getByRole('button', { name: 'Remove page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(useProjectStore.getState().files[FILE]).toContain('= Two');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('takes the page away once the removal is confirmed', async () => {
    useProjectStore.getState().setFileText(FILE, `= One\n\n${PAGE_BREAK}\n\n= Two\n`);

    await openFile();

    fireEvent.click(screen.getByRole('button', { name: 'Remove page' }));

    const dialog = screen.getByRole('dialog', { name: 'Remove page' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove page' }));

    // The cursor sits on the first page, so that is the page that goes.
    await waitFor(() => {
      expect(useProjectStore.getState().files[FILE]).not.toContain('= One');
    });
    expect(useProjectStore.getState().files[FILE]).toContain('= Two');
  });

  it('asks before a file is taken out of the document', async () => {
    await openFile();

    fireEvent.click(screen.getByRole('button', { name: 'Remove report.typ' }));

    expect(screen.getByRole('dialog', { name: 'Remove file' })).toBeInTheDocument();
    expect(useProjectStore.getState().project.content).toEqual([FILE]);
  });

  it('takes the file out of the document once the removal is confirmed', async () => {
    await openFile();

    fireEvent.click(screen.getByRole('button', { name: 'Remove report.typ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove file' }));

    await waitFor(() => {
      expect(useProjectStore.getState().project.content).toEqual([]);
    });
  });
});
