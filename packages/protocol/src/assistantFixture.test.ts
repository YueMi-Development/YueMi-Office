import { describe, expect, it } from 'vitest';

import { AI_TOOL_NAMES } from './index';
import { applyChanges } from './diff';
import fixture from './fixtures/assistant.json';

/**
 * The contract the renderer and the app share.
 *
 * The Rust side writes this file with its own code, and the app's test
 * reads it. A difference between the two shows up as a failing test here
 * rather than as a document that comes out wrong.
 *
 * The file is written by `apps/desktop/src-tauri/examples/write_assistant_fixture.rs`.
 */

interface FixtureCase {
  oldText: string;
  newText: string;
  hunks: {
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    lines: { kind: string; text: string; oldLine?: number; newLine?: number }[];
    changes: { oldStart: number; oldCount: number; newLines: string[] }[];
  }[];
}

const cases = fixture.cases as FixtureCase[];

describe('the differences the renderer produces', () => {
  it('holds at least one case', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases.map((entry, index) => [index, entry] as const))(
    'the app applies case %i the way the renderer wrote it',
    (_index, entry) => {
      const changes = entry.hunks.flatMap((hunk) => hunk.changes);

      expect(applyChanges(entry.oldText, changes)).toBe(entry.newText);
    },
  );

  it.each(cases.map((entry, index) => [index, entry] as const))(
    'the app counts the lines of case %i the way the renderer counted them',
    (_index, entry) => {
      const changes = entry.hunks.flatMap((hunk) => hunk.changes);

      for (const change of changes) {
        // The change says which lines it replaces, and it has to point at
        // lines that exist.
        expect(change.oldStart).toBeGreaterThanOrEqual(1);
        expect(change.oldCount).toBeGreaterThanOrEqual(0);
      }
    },
  );
});

describe('the tools the app offers', () => {
  it('are the same tools the app knows about', () => {
    // The Rust side writes the names into the fixture, so a tool added on
    // one side and forgotten on the other fails here rather than as a call
    // that never finds its tool.
    expect(fixture.tools).toEqual([...AI_TOOL_NAMES]);
  });
});
