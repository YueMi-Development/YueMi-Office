import { describe, expect, it } from 'vitest';

import { reasonOf } from './tauri';

/**
 * Why a call failed, as text.
 *
 * The shell rejects a call with the reason as a plain value rather than as
 * an Error, so a check of `instanceof Error` never finds the reason. These
 * tests cover the shapes a failure can arrive in.
 */
describe('the reason a call failed', () => {
  it('takes the reason from a plain value', () => {
    expect(reasonOf("'OpenAI' has no key yet.", 'fallback')).toBe(
      "'OpenAI' has no key yet.",
    );
  });

  it('takes the reason from an error', () => {
    expect(reasonOf(new Error('The disk is full.'), 'fallback')).toBe(
      'The disk is full.',
    );
  });

  it('falls back when there is no reason', () => {
    expect(reasonOf(undefined, 'fallback')).toBe('fallback');
    expect(reasonOf('', 'fallback')).toBe('fallback');
    expect(reasonOf(new Error(''), 'fallback')).toBe('fallback');
  });
});
