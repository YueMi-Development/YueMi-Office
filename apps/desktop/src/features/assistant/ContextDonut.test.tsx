import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ContextDonut, formatTokens } from './ContextDonut';

/**
 * The ring that shows how much of the model's context is used.
 *
 * The ring is only drawn when the size of the context is known: a ring
 * against a size nobody knows would be a number that cannot be stood
 * behind, so nothing is drawn instead.
 */
describe('the context ring', () => {
  it('is drawn when the size of the context is known', () => {
    render(<ContextDonut used={18000} window={200000} estimated={false} />);

    expect(
      screen.getByRole('img', { name: 'Context: 18k of 200k tokens' }),
    ).toBeInTheDocument();
  });

  it('is not drawn when the size of the context is not known', () => {
    const { container } = render(
      <ContextDonut used={18000} window={null} estimated={false} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('is not drawn when the size of the context is nothing', () => {
    const { container } = render(
      <ContextDonut used={18000} window={0} estimated={false} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('says when the number of tokens was estimated', () => {
    render(<ContextDonut used={18000} window={200000} estimated />);

    expect(
      screen.getByRole('img', { name: 'Context: 18k of 200k tokens, estimated' }),
    ).toBeInTheDocument();
  });

  it('shortens the numbers', () => {
    expect(formatTokens(512)).toBe('512');
    expect(formatTokens(1800)).toBe('1.8k');
    expect(formatTokens(1047576)).toBe('1M');
  });
});
