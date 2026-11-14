import { describe, expect, it } from 'vitest';

import { LINTER_NAMES, linterFor, lintersFor } from './changedLinters';

/**
 * The rule that decides which linter a changed file reaches.
 *
 * The hook before a push uses it to skip the linters that a change does
 * not reach, so a mistake in it is a lint that is skipped or a lint that
 * runs for nothing. The rules are checked one by one here, because each
 * of them answers a question that is easy to get wrong: a manifest of the
 * Rust crate is a TOML file and a JSON file that the Rust build reads, and
 * a script that lints a section is part of that section.
 */

describe('linterFor', () => {
  it('sends the Rust tree to the Rust linter', () => {
    expect(linterFor('apps/desktop/src-tauri/src/main.rs')).toBe('rust');
  });

  it('sends the manifest of the Rust crate to the Rust linter', () => {
    // The manifest is a TOML file and a JSON file, and the Rust build is
    // what reads it. The extension rule would send it to the TypeScript
    // linter, which knows nothing about it.
    expect(linterFor('apps/desktop/src-tauri/Cargo.toml')).toBe('rust');
    expect(linterFor('apps/desktop/src-tauri/tauri.conf.json')).toBe('rust');
  });

  it('sends the TypeScript tree to the frontend linter', () => {
    expect(linterFor('apps/desktop/src/lib/changedLinters.ts')).toBe('frontend');
    expect(linterFor('packages/protocol/src/index.ts')).toBe('frontend');
    expect(linterFor('scripts/lint-changed.ts')).toBe('frontend');
  });

  it('sends the configuration of the frontend linter to the frontend linter', () => {
    // The rules of the linter are part of what the linter checks, so a
    // change to them is a change to the section they apply to.
    expect(linterFor('eslint.config.mjs')).toBe('frontend');
    expect(linterFor('.prettierrc.json')).toBe('frontend');
    expect(linterFor('package.json')).toBe('frontend');
  });

  it('sends the lockfile to the frontend linter', () => {
    // The lockfile records the dependencies of the TypeScript tree.
    expect(linterFor('bun.lock')).toBe('frontend');
  });

  it('sends the script that lints a section to that section', () => {
    // A change to the script is a change to what the lint says.
    expect(linterFor('.github/scripts/lint-frontend.sh')).toBe('frontend');
    expect(linterFor('.github/scripts/lint-rust.sh')).toBe('rust');
  });

  it('sends the prose to no linter', () => {
    // The prose is written to be read, and no linter reads it.
    expect(linterFor('docs/linting.md')).toBeNull();
    expect(linterFor('README.md')).toBeNull();
    expect(linterFor('docs/PRD-typst-document-studio.md')).toBeNull();
  });

  it('sends the workflows to no linter', () => {
    // The workflow files are read by the CI, not by a linter.
    expect(linterFor('.github/workflows/ci.yml')).toBeNull();
  });

  it('sends the example project to no linter', () => {
    expect(linterFor('examples/sample/document.typ')).toBeNull();
  });

  it('sends a file without an extension to no linter', () => {
    expect(linterFor('LICENSE')).toBeNull();
  });

  it('reads a path that comes with a backslash', () => {
    // The path may come from a tool that writes it the way Windows does,
    // and the comparison is a comparison of text.
    expect(linterFor('apps\\desktop\\src-tauri\\Cargo.toml')).toBe('rust');
  });

  it('reads a path that starts with a dot slash', () => {
    expect(linterFor('./apps/desktop/src-tauri/Cargo.toml')).toBe('rust');
  });
});

describe('lintersFor', () => {
  it('says nothing when nothing changed', () => {
    expect(lintersFor([])).toEqual([]);
  });

  it('says nothing when the change is the prose', () => {
    expect(lintersFor(['docs/linting.md', 'README.md'])).toEqual([]);
  });

  it('says one linter when one section changed', () => {
    expect(lintersFor(['apps/desktop/src-tauri/src/main.rs'])).toEqual(['rust']);
  });

  it('says the linters in a fixed order', () => {
    // The order the linters run in must not depend on the order the files
    // changed in, or two pushes of the same change would differ.
    expect(
      lintersFor(['apps/desktop/src-tauri/src/main.rs', 'apps/desktop/src/lib/app.ts']),
    ).toEqual(['frontend', 'rust']);
  });

  it('says a linter once however many of its files changed', () => {
    expect(
      lintersFor([
        'apps/desktop/src/lib/a.ts',
        'apps/desktop/src/lib/b.ts',
        'apps/desktop/src/lib/c.ts',
      ]),
    ).toEqual(['frontend']);
  });

  it('says every linter that a wide change reaches', () => {
    expect(
      lintersFor(['apps/desktop/src/lib/app.ts', 'apps/desktop/src-tauri/src/main.rs']),
    ).toEqual(['frontend', 'rust']);
  });

  it('knows the two linters of the repository', () => {
    expect(LINTER_NAMES).toEqual(['frontend', 'rust']);
  });
});
