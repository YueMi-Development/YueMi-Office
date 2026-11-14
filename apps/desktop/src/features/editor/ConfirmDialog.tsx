import { useEffect } from 'react';

export interface ConfirmDialogProps {
  /** The heading of the dialog. */
  title: string;
  /** What the dialog says about what is about to happen. */
  message: string;
  /** The label of the button that carries the action out. */
  confirmLabel: string;
  /** Called when the action is confirmed. */
  onConfirm: () => void;
  /** Called when the dialog is dismissed without doing anything. */
  onCancel: () => void;
}

/**
 * A dialog that asks before something is destroyed.
 *
 * The dialog is the same shape as the other two the app has, so it looks like
 * the rest of the app. Escape and a click on the backdrop both dismiss it,
 * which means there is no way to lose the dialog without answering it.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancel();
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onCancel]);

  return (
    <div
      className="template-picker"
      role="presentation"
      onClick={(event) => {
        // The click is only a click on the backdrop when it landed on the
        // backdrop itself. A click inside the panel lands on the panel, and
        // the panel is not a button and does not need to be one.
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        className="template-picker-panel confirm-panel"
        role="dialog"
        aria-label={title}
        aria-modal="true"
      >
        <h2 className="template-picker-title">{title}</h2>

        <p className="confirm-message">{message}</p>

        <div className="template-picker-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
