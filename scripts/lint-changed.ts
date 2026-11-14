#!/usr/bin/env bun
/**
 * Say which linters the changes on this branch reach.
 *
 *     bun run scripts/lint-changed.ts
 *
 * The hook that runs before a push asks this script what changed, so that
 * a push that touched prose does not pay for a Rust compile and a Docker
 * image build. The script prints one linter name per line, and nothing
 * else on the standard output, so the hook can read the answer directly.
 *
 * The changed set is the union of three things: the commits that are not on
 * the upstream yet, the changes that are not committed yet, and the files
 * that are new and not ignored. A file that has never been committed counts
 * as a change, or a new file would never be linted before its first push.
 *
 * When the upstream cannot be found, the script prints `all` rather than
 * nothing. Not being able to tell what changed is not a reason to skip
 * the lint: the safe reading is that everything changed.
 */

import { resolve } from 'node:path';

import { lintersFor } from '../apps/desktop/src/lib/changedLinters.ts';

const root = resolve(import.meta.dir, '..');

/** Runs a git command and returns its standard output, or null when it fails. */
function git(...args: string[]): string | null {
  const result = Bun.spawnSync(['git', ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (result.exitCode !== 0) {
    return null;
  }

  return result.stdout.toString();
}

/** The lines of the output of a git command, without the empty ones. */
function lines(output: string | null): string[] {
  return (output ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * The commit the changes are measured against.
 *
 * The upstream of the branch is the right one, because it is the point
 * where this branch was published. A branch that has no upstream falls
 * back to the two branch names the repository is likely to use, and the
 * merge base of that ref and HEAD is where the two lines parted, which is
 * the point the changes are measured from.
 *
 * Null means the repository has no ref to measure against.
 */
function baseCommit(): string | null {
  const upstream = lines(git('rev-parse', '--abbrev-ref', '@{u}'))[0];

  const candidates = upstream
    ? [upstream]
    : ['origin/master', 'origin/main'].filter(
        (name) => git('rev-parse', '--verify', name) !== null,
      );

  for (const candidate of candidates) {
    const mergeBase = lines(git('merge-base', 'HEAD', candidate))[0];

    if (mergeBase) {
      return mergeBase;
    }
  }

  return null;
}

/** The paths that changed, relative to the root of the repository. */
function changedPaths(base: string): string[] {
  const paths = new Set<string>();

  // The commits that are not on the upstream yet.
  for (const path of lines(git('diff', '--name-only', base, 'HEAD'))) {
    paths.add(path);
  }

  // What is staged and what is modified in the working tree.
  for (const path of lines(git('diff', '--name-only', 'HEAD'))) {
    paths.add(path);
  }

  // The files that are new and not ignored.
  for (const path of lines(git('ls-files', '--others', '--exclude-standard'))) {
    paths.add(path);
  }

  return [...paths];
}

const base = baseCommit();

// Without a base there is no way to tell what changed, so everything is
// linted rather than nothing.
if (!base) {
  process.stdout.write('all\n');
  process.exit(0);
}

for (const linter of lintersFor(changedPaths(base))) {
  process.stdout.write(`${linter}\n`);
}
