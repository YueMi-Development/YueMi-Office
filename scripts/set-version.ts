#!/usr/bin/env bun
/**
 * Put a version into the files that carry it.
 *
 * The release workflow calls this with the version the tag names, and a
 * developer can call it by hand before making a build. The version is
 * written into the tree, so the files it changes should be looked at
 * before they are committed.
 *
 *     bun run scripts/set-version.ts 1.0.0
 *     bun run scripts/set-version.ts 1.0.0-beta
 *     bun run scripts/set-version.ts 1.0.0 --force
 *
 * A file that already carries the version is left alone, because
 * rewriting it would make the tree look changed when it was not. The
 * `--force` flag writes every file regardless.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  applyVersion,
  parseVersion,
  VERSION_FILES,
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

/** The version the script was given. */
const given = process.argv[2];

/** Whether every file is written, even the ones that already agree. */
const force = process.argv.includes('--force');

/** What to do when the version is not one. */
function refuse(): never {
  process.stderr.write(
    'A version is three numbers, an optional pre-release identifier and ' +
      'optional build metadata: 1.0.0, 1.0.0-beta.\n',
  );
  process.exit(1);
}

if (!given) {
  refuse();
}

if (!parseVersion(given)) {
  refuse();
}

const files = await readVersionFiles();
const updated = applyVersion(files, given);

const changed: string[] = [];
const unchanged: string[] = [];

for (const [key, path] of Object.entries(VERSION_FILES)) {
  const before = files[key as keyof VersionFiles];
  const after = updated[key as keyof VersionFiles];

  if (!force && before === after) {
    unchanged.push(path);
    continue;
  }

  await writeFile(resolve(root, path), after);
  changed.push(path);
}

for (const path of changed) {
  process.stdout.write(`changed ${path}\n`);
}

for (const path of unchanged) {
  process.stdout.write(`already ${path}\n`);
}

process.stdout.write(`${changed.length} changed, ${unchanged.length} unchanged\n`);
