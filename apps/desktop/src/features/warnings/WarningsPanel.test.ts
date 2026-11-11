import { describe, expect, it } from 'vitest';
import type { RenderWarning } from '@yuemi/protocol';

import { groupWarnings } from './WarningsPanel';

describe('groupWarnings', () => {
  it('returns nothing for a document without warnings', () => {
    expect(groupWarnings([])).toEqual([]);
  });

  it('groups warnings of the same kind together', () => {
    const warnings: RenderWarning[] = [
      { code: 'layout.overflow', message: 'A table is too wide' },
      { code: 'layout.overflow', message: 'A row is too tall' },
      { code: 'font.unresolved', message: 'Inter is not bundled' },
    ];

    const groups = groupWarnings(warnings);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.code).toBe('layout.overflow');
    expect(groups[0]?.warnings).toHaveLength(2);
    expect(groups[1]?.code).toBe('font.unresolved');
  });

  it('gives a kind a readable title', () => {
    const groups = groupWarnings([
      { code: 'layout.overflow', message: 'A table is too wide' },
    ]);

    expect(groups[0]?.title).toBe('Content does not fit');
  });

  it('falls back to the code for a kind it does not know', () => {
    const groups = groupWarnings([{ code: 'mystery.code', message: 'Hello' }]);

    expect(groups[0]?.title).toBe('mystery.code');
  });
});
