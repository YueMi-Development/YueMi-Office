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

for (const [key, path] of Object.entries(VERSION_FILES)) {
  await writeFile(resolve(root, path), updated[key as keyof VersionFiles]);
  process.stdout.write(`${path}\n`);
}
