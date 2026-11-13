#!/usr/bin/env bun
/**
 * Write the icons of the app into the folder the bundler reads them from.
 *
 *     bun run scripts/generate-icons.ts
 *
 * The icons are not kept in the repository. They are derived from one
 * picture, `.github/assets/Logo.png`, and a tree that carries them in
 * git carries fifteen files that have to be changed together with that
 * picture. Deriving them instead means there is one picture to change
 * and no way for the derived files to fall behind it.
 *
 * The Tauri CLI does the work, because it is the tool that knows which
 * files each platform's bundler wants. The mobile folders it writes are
 * removed afterwards, because this is a desktop app and the folders
 * would be dead weight in the tree.
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

/** The picture every icon is derived from. */
const source = resolve(import.meta.dir, '../.github/assets/Logo.png');

/** The folder the bundler reads the icons from. */
const output = resolve(import.meta.dir, '../apps/desktop/src-tauri/icons');

/**
 * The folders the CLI writes for the mobile platforms.
 *
 * The app is a desktop app, so nothing reads them.
 */
const MOBILE_FOLDERS = ['android', 'ios'];

try {
  await access(source);
} catch {
  process.stderr.write(`The picture the icons are made of is missing: ${source}\n`);
  process.exit(1);
}

const child = spawn(
  'bun',
  ['run', '--cwd', 'apps/desktop', 'tauri', 'icon', source, '--output', output],
  {
    cwd: resolve(import.meta.dir, '..'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);

// The script waits for the tool rather than ending when the tool ends, so
// that the folders it writes are removed before the script reports that it
// is done.
const [code, signal] = (await once(child, 'exit')) as [
  number | null,
  NodeJS.Signals | null,
];

if (signal) {
  process.stderr.write(`The icon generation was stopped by ${signal}.\n`);
  process.exit(1);
}

if (code !== 0) {
  process.exit(code ?? 1);
}

for (const folder of MOBILE_FOLDERS) {
  await rm(resolve(output, folder), { recursive: true, force: true });
}

process.stdout.write(`The icons are in ${output}\n`);
