#!/usr/bin/env bun
/**
 * Report where the version is declared, and whether the places agree.
 *
 * The version of a build is decided by its tag, and the tag's version is
 * written into the tree before the build. That means the version in the
 * tree is a declaration of intent rather than the number that is built,
 * and it can be left behind by a release. This script says what every
 * place currently says, and fails when they disagree, so a tree that
 * would build the wrong thing is caught by the ordinary CI rather than
 * by somebody who installed it.
 *
 *     bun run scripts/version-report.ts
 *
 * The exit code is the answer: zero when every place agrees, one when
 * they do not.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  VERSION_FILES,
  VERSION_PROJECTS,
  versionsInFiles,
  type VersionFiles,
} from '../apps/desktop/src/lib/version.ts';

const root = resolve(import.meta.dir, '..');

/** Reads every file that carries the version. */
async function readVersionFiles(): Promise<VersionFiles> {
  const entries = await Promise.all(
    Object.entries(VERSION_FILES).map(async ([key, path]) => {
      const contents = await readFile(resolve(root, path), 'utf8');
      return [key, contents] as const;
    }),
  );

  return Object.fromEntries(entries) as VersionFiles;
}

const files = await readVersionFiles();
const versions = versionsInFiles(files);
const distinct = new Set(Object.values(versions));

for (const [key, path] of Object.entries(VERSION_FILES)) {
  const version = versions[key as keyof typeof versions];

  process.stdout.write(
    `${(version ?? '(none)').padEnd(16)} ${VERSION_PROJECTS[key as keyof typeof VERSION_PROJECTS].padEnd(20)} ${path}\n`,
  );
}

if (distinct.size === 1) {
  process.stdout.write(`\nEvery place says ${[...distinct][0]}.\n`);
  process.exit(0);
}

process.stderr.write(
  '\nThe places do not agree: ' +
    `${[...distinct].map((version) => version || '(none)').join(', ')}.\n` +
    'A build from this tree would carry a version that is not the one it was tagged with.\n',
);
process.exit(1);
