import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from './ConfirmDialog';

/**
 * The dialog that asks before something is destroyed.
 *
 * What matters is that it can be answered both ways: the action only runs
 * when the user says so, and every way of dismissing it leaves the document
 * alone.
 */

function renderDialog() {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  render(
    <ConfirmDialog
      title="Remove page"
      message="The page 2 of report.typ will be taken out."
      confirmLabel="Remove page"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );

  return { onConfirm, onCancel };
}

describe('ConfirmDialog', () => {
  it('says what is about to happen', () => {
    renderDialog();

    expect(screen.getByRole('dialog', { name: 'Remove page' })).toBeInTheDocument();
    expect(
      screen.getByText('The page 2 of report.typ will be taken out.'),
    ).toBeInTheDocument();
  });

  it('runs the action when it is confirmed', () => {
    const { onConfirm, onCancel } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Remove page' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels from the Cancel button', () => {
    const { onConfirm, onCancel } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancels on Escape', () => {
    const { onConfirm, onCancel } = renderDialog();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancels on a click on the backdrop', () => {
    const { onConfirm, onCancel } = renderDialog();

    fireEvent.click(screen.getByRole('presentation'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('stays open when the panel itself is clicked', () => {
    const { onConfirm, onCancel } = renderDialog();

    fireEvent.click(screen.getByRole('dialog'));

    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
