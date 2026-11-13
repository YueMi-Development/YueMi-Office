#!/usr/bin/env bun
/**
 * Build the desktop app and its installers for this machine.
 *
 * The app is a Tauri app, so the build is `tauri build`, which compiles
 * the Rust side, bundles the frontend into it, and writes the
 * installers for the platform it runs on.
 *
 *     bun run scripts/build-desktop.ts
 *     bun run scripts/build-desktop.ts --debug
 *     bun run scripts/build-desktop.ts --bundles nsis,msi
 *
 * The system packages the build needs are different on each platform,
 * so they are printed before the build starts rather than discovered
 * halfway through it.
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

/** What each platform needs before the build can run. */
const PREREQUISITES: Record<string, string[]> = {
  linux: [
    'libwebkit2gtk-4.1-dev',
    'libayatana-appindicator3-dev',
    'librsvg2-dev',
    'patchelf',
    'xdg-utils',
    'libfuse2 (for the AppImage)',
  ],
  darwin: [
    'Xcode command line tools (xcode-select --install)',
    'the AppImage and Linux bundles are not built on macOS',
  ],
  win32: [
    'Microsoft C++ Build Tools, with the Desktop development workload',
    'the WebView2 runtime (already present on Windows 11)',
  ],
};

/** The flags the script was given. */
const flags = process.argv.slice(2);

/** Whether the build is a debug build. */
const debug = flags.includes('--debug');

/** The bundles to build, when the script was told which ones. */
const bundlesIndex = flags.indexOf('--bundles');
const bundles =
  bundlesIndex === -1 ? null : (flags[bundlesIndex + 1] ?? null);

/** The arguments the Tauri CLI is given. */
const args = ['build'];

if (debug) {
  args.push('--debug');
}

if (bundles) {
  args.push('--bundles', bundles);
}

const platform = process.platform;

process.stdout.write(`Building yuemi for ${platform}.\n\n`);
process.stdout.write('This build needs:\n');

for (const item of PREREQUISITES[platform] ?? []) {
  process.stdout.write(`  - ${item}\n`);
}

process.stdout.write('\n');

const root = resolve(import.meta.dir, '..');

const child = spawn(
  'bun',
  ['run', '--cwd', 'apps/desktop', 'tauri', ...args],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.stderr.write(`The build was stopped by ${signal}.\n`);
    process.exit(1);
  }

  process.exit(code ?? 1);
});
