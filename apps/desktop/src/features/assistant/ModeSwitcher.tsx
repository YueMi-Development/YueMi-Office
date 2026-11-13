import type { AssistantMode } from '@yuemi/protocol';

/**
 * Choosing how the assistant runs.
 *
 * The two modes are chosen with one button each rather than a dropdown,
 * because there are only two and they are the thing the user reaches for
 * most often.
 */

export interface ModeSwitcherProps {
  /** How the assistant is running. */
  mode: AssistantMode;
  /** Changes how the assistant runs. */
  onChange: (mode: AssistantMode) => void;
}

/** The modes, in the order they are shown. */
const MODES: { value: AssistantMode; label: string; hint: string }[] = [
  {
    value: 'chat',
    label: 'Chat',
    hint: 'Ask questions about the document. Nothing is changed.',
  },
  {
    value: 'agent',
    label: 'Agent',
    hint: 'Work on the document. Changes are proposed for you to accept.',
  },
];

export function ModeSwitcher({ mode, onChange }: ModeSwitcherProps) {
  return (
    <div className="chat-modes" role="group" aria-label="How the assistant runs">
      {MODES.map((entry) => (
        <button
          key={entry.value}
          type="button"
          className={
            mode === entry.value ? 'chat-mode chat-mode-active' : 'chat-mode'
          }
          aria-pressed={mode === entry.value}
          title={entry.hint}
          onClick={() => onChange(entry.value)}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}
