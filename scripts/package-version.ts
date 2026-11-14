#!/usr/bin/env bun
/**
 * Print the version the Linux packages carry.
 *
 *     bun run scripts/package-version.ts
 *     bun run scripts/package-version.ts 1.0.0-beta
 *
 * The Tauri bundler takes one version and uses it for every file name and
 * every package it writes, and the configuration it reads refuses anything
 * that is not plain semver. The Linux packages are the two that cannot take
 * a dash: rpm rejects one outright, and Debian reads `1.0.0-beta` as
 * `1.0.0` with a revision, which sorts after the finished release and so
 * stops apt from upgrading to it.
 *
 * Both tools understand a tilde, and `1.0.0~beta` sorts before the plain
 * `1.0.0`, which is the order a pre-release has to have.
 *
 * With no argument the version of the tree is used, so that the script
 * says what the build is going to produce rather than what it was asked.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  VERSION_FILES,
  packageVersion,
  parseVersion,
} from '../apps/desktop/src/lib/version.ts';

const root = resolve(import.meta.dir, '..');

/** The version to print, which is the tree's when none is given. */
async function wanted(): Promise<string> {
  const given = process.argv[2];

  if (given) {
    return given;
  }

  const path = resolve(root, VERSION_FILES.tauriConfig);
  const contents = await readFile(path, 'utf8');
  const parsed = JSON.parse(contents) as { version?: string };

  if (!parsed.version) {
    throw new Error(`${path} carries no version.`);
  }

  return parsed.version;
}

const version = await wanted();
const parsed = parseVersion(version);

if (!parsed) {
  process.stderr.write(`Not a version: ${version}\n`);
  process.exit(1);
}

process.stdout.write(`${packageVersion(parsed)}\n`);
