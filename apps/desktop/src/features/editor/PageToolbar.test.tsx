import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PageToolbar } from './PageToolbar';

/**
 * The bar above the editor.
 *
 * It says which page the cursor is on, and it carries the two actions that
 * change the pages of the file: adding one and taking one away.
 */

function renderToolbar(
  overrides: Partial<React.ComponentProps<typeof PageToolbar>> = {},
) {
  const onAddPage = vi.fn();
  const onRemovePage = vi.fn();

  render(
    <PageToolbar
      fileName="report.typ"
      pageIndex={1}
      pageCount={3}
      canEdit
      onAddPage={onAddPage}
      onRemovePage={onRemovePage}
      {...overrides}
    />,
  );

  return { onAddPage, onRemovePage };
}

describe('PageToolbar', () => {
  it('says which file and page are open', () => {
    renderToolbar();

    expect(screen.getByText('report.typ')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('asks for a page to be added', () => {
    const { onAddPage } = renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: 'Add page' }));

    expect(onAddPage).toHaveBeenCalledTimes(1);
  });

  it('asks for a page to be removed', () => {
    const { onRemovePage } = renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: 'Remove page' }));

    expect(onRemovePage).toHaveBeenCalledTimes(1);
  });

  it('cannot remove a page from a file that has only one', () => {
    renderToolbar({ pageIndex: 0, pageCount: 1 });

    expect(screen.getByRole('button', { name: 'Remove page' })).toBeDisabled();
  });

  it('cannot change the pages of a file that is not part of the document', () => {
    renderToolbar({ canEdit: false });

    expect(screen.getByRole('button', { name: 'Add page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove page' })).toBeDisabled();
  });
});
