/**
 * How much of the model's context the conversation takes up.
 *
 * The ring is drawn only when the size of the model's context is known.
 * Without it there is nothing honest to draw: a ring against an unknown
 * size would be a number nobody can stand behind, so nothing is shown at
 * all rather than an empty ring.
 */

export interface ContextDonutProps {
  /** The tokens the conversation takes up. */
  used: number;
  /** The tokens the model can take at once, when it is known. */
  window: number | null;
  /** Whether the number of tokens was estimated rather than reported. */
  estimated: boolean;
}

/** The size of the ring, in pixels. */
const SIZE = 26;

/** How thick the ring is. */
const THICKNESS = 3;

/**
 * How a number of tokens is written out.
 *
 * The numbers are in the thousands and millions, so they are shortened.
 */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) {
    return `${tokens}`;
  }
  if (tokens < 1_000_000) {
    const thousands = tokens / 1000;
    return `${thousands >= 100 ? Math.round(thousands) : Math.round(thousands * 10) / 10}k`;
  }
  return `${Math.round(tokens / 100_000) / 10}M`;
}

export function ContextDonut({ used, window, estimated }: ContextDonutProps) {
  if (!window || window <= 0) {
    return null;
  }

  const share = Math.min(1, Math.max(0, used / window));
  const radius = (SIZE - THICKNESS) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * share;

  // The colour says how much is left: green while there is plenty, amber
  // when the context is filling up, red when it is nearly full.
  const tone = share >= 0.9 ? 'danger' : share >= 0.7 ? 'warn' : 'calm';

  return (
    <div
      className={`chat-donut chat-donut-${tone}`}
      role="img"
      aria-label={`Context: ${formatTokens(used)} of ${formatTokens(window)} tokens${
        estimated ? ', estimated' : ''
      }`}
      title={`Context: ${formatTokens(used)} of ${formatTokens(window)} tokens${
        estimated ? ' (estimated)' : ''
      }`}
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden="true"
      >
        <circle
          className="chat-donut-track"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={radius}
          fill="none"
          strokeWidth={THICKNESS}
        />
        <circle
          className="chat-donut-fill"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={radius}
          fill="none"
          strokeWidth={THICKNESS}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </svg>
      <span className="chat-donut-text">{formatTokens(used)}</span>
    </div>
  );
}
