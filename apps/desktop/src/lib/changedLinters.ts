/**
 * Which linter a changed file belongs to.
 *
 * The tree is written in three languages, and each of them has a linter.
 * Running all three on every push costs a Rust compile and a Docker image
 * build for a push that only touched prose, so the hook asks this file which
 * linters the change reaches.
 *
 * The rule is per section rather than per file: a whole linter runs or does
 * not run. That way the run on this machine is the same run the CI does for
 * that section, and a file that is passed to ESLint is passed to it in
 * exactly the way the CI would pass it.
 *
 * The mapping is a pure function of the paths, so it can be tested without
 * a repository and without a push.
 */

/** The linters of the repository, by the language they lint. */
export const LINTER_NAMES = ['frontend', 'rust', 'backend'] as const;

/** The name of one of the linters. */
export type LinterName = (typeof LINTER_NAMES)[number];

/**
 * The directories that hold the two languages that are not TypeScript.
 *
 * They are looked for first, because a file in one of them can carry an
 * extension that would otherwise send it to the TypeScript linter: the
 * manifest of the desktop app is a JSON file that the Rust build reads.
 */
const RUST_ROOT = 'apps/desktop/src-tauri/';
const BACKEND_ROOT = 'apps/api/';

/**
 * The extensions the TypeScript linter reads.
 *
 * The list is the set of files ESLint and Prettier are pointed at, and it
 * does not include the Rust, Python or YAML files, because each of those
 * has a linter of its own.
 */
const FRONTEND_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.json',
];

/**
 * The linter a path belongs to, or null when it belongs to none.
 *
 * The path is one that git printed, so it is relative to the root of the
 * repository and it uses forward slashes. A path that came from another
 * system is normalized first, because the comparison is a comparison of
 * text.
 */
export function linterFor(path: string): LinterName | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');

  // The two directories win over the extension, because they hold files
  // whose extension says nothing about the language they are written in.
  if (normalized.startsWith(RUST_ROOT)) {
    return 'rust';
  }

  if (normalized.startsWith(BACKEND_ROOT)) {
    return 'backend';
  }

  // The script that lints a section is part of that section: a change to
  // it is a change to what the lint says.
  const script = /^\.github\/scripts\/lint-([a-z]+)\.sh$/.exec(normalized);

  if (script) {
    const name = script[1];

    if ((LINTER_NAMES as readonly string[]).includes(name)) {
      return name as LinterName;
    }
  }

  // The lockfile records the dependencies of the TypeScript tree, so a
  // change to it is a change to that tree.
  if (normalized === 'bun.lock') {
    return 'frontend';
  }

  const dot = normalized.lastIndexOf('.');

  if (dot === -1) {
    return null;
  }

  const extension = normalized.slice(dot);

  return FRONTEND_EXTENSIONS.includes(extension) ? 'frontend' : null;
}

/**
 * The linters that the changed paths reach.
 *
 * The result carries no duplicates and is in a fixed order, so the linters
 * run in the same order whatever order the files changed in.
 */
export function lintersFor(paths: string[]): LinterName[] {
  const selected = new Set<LinterName>();

  for (const path of paths) {
    const linter = linterFor(path);

    if (linter) {
      selected.add(linter);
    }
  }

  return LINTER_NAMES.filter((name) => selected.has(name));
}
