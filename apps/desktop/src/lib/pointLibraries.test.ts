import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/**
 * The script that points the loader at the libraries on Windows.
 *
 * The visual check on a Windows runner failed for a whole run because of
 * this script. The location of the toolchain was written into the command
 * that runs the script:
 *
 *     run: .github/scripts/point-libraries.sh windows ${{ ... }}
 *
 * The shell reads that command before the script does, and a path with
 * backslashes in it loses them there. The script was handed
 * `D:a_tempmsys64` instead of `D:\a\_temp\msys64`, and the loader was
 * pointed at a folder that is not there. The failure arrived much later,
 * as a message about a library that could not be found, with nothing in
 * it that named the path.
 *
 * So the script reads the location from the environment now, and the test
 * runs it the way the workflow runs it.
 */

/**
 * The script the workflow calls.
 *
 * The workflow runs the script from the root of the repository, and the
 * test runs it the same way, so the script is looked for from the root
 * rather than from the folder the tests happen to be in.
 */
function scriptPath(): string {
  let folder = process.cwd();

  while (folder !== dirname(folder)) {
    const candidate = join(folder, '.github', 'scripts', 'point-libraries.sh');

    if (existsSync(candidate)) {
      return candidate.replaceAll('\\', '/');
    }

    folder = dirname(folder);
  }

  throw new Error('The script that points the loader at the libraries was not found.');
}

/**
 * A toolchain that looks like the one the runner installs.
 *
 * The library is a file with the name of the one the loader looks for,
 * because the script checks that the folder it points at holds it.
 */
function toolchain(): { root: string; location: string } {
  const root = mkdtempSync(join(tmpdir(), 'point-libraries-'));
  const folder = join(root, 'msys64', 'ucrt64', 'bin');

  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'libgobject-2.0-0.dll'), '');

  // The location is written the way Windows writes it, with backslashes
  // between the folders.
  const location = join(root, 'msys64').replaceAll('/', '\\');

  return { root, location };
}

/** The lines the script wrote for the runner. */
function runScript(location: string): { output: string; status: number } {
  const root = mkdtempSync(join(tmpdir(), 'point-libraries-env-'));
  const envFile = join(root, 'github-env');

  const result = spawnSync('bash', [scriptPath(), 'windows'], {
    env: {
      ...process.env,
      GITHUB_ENV: envFile,
      MSYS2_LOCATION: location,
    },
    encoding: 'utf8',
  });

  return {
    output: readFileSync(envFile, 'utf8'),
    status: result.status ?? 1,
  };
}

describe('the script that points the loader at the libraries', () => {
  it('keeps the backslashes of the location', () => {
    // This is the mistake that broke the visual check. The location went
    // through the environment and came out the way it went in.
    const { location } = toolchain();
    const { output, status } = runScript(location);

    expect(status).toBe(0);
    expect(output).toContain('WEASYPRINT_DLL_DIRECTORIES=');
    expect(output).toContain(`${location}\\ucrt64\\bin`);
  });

  it('names the runtime that the loader keeps by itself', () => {
    // Naming the variable replaces the list WeasyPrint keeps rather than
    // adding to it, so the runtime has to be named again.
    const { location } = toolchain();
    const { output } = runScript(location);

    expect(output).toContain('C:\\Program Files\\GTK3-Runtime Win64\\bin');
  });

  it('takes the location from the argument when there is one', () => {
    // A script called by hand has no environment to read.
    const { location } = toolchain();
    const root = mkdtempSync(join(tmpdir(), 'point-libraries-env-'));
    const envFile = join(root, 'github-env');

    const result = spawnSync('bash', [scriptPath(), 'windows', location], {
      env: { ...process.env, GITHUB_ENV: envFile },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(readFileSync(envFile, 'utf8')).toContain(`${location}\\ucrt64\\bin`);
  });

  it('says which folder is missing when there is none', () => {
    // A path that is not there used to fail much later, as a message about
    // a library that could not be found. The name of the folder is in the
    // message now.
    const root = mkdtempSync(join(tmpdir(), 'point-libraries-missing-'));
    const location = join(root, 'nowhere').replaceAll('/', '\\');
    const result = spawnSync('bash', [scriptPath(), 'windows'], {
      env: {
        ...process.env,
        GITHUB_ENV: join(root, 'github-env'),
        MSYS2_LOCATION: location,
      },
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${location}\\ucrt64\\bin`);
  });

  it('says that the location is needed when there is none', () => {
    const root = mkdtempSync(join(tmpdir(), 'point-libraries-none-'));
    const result = spawnSync('bash', [scriptPath(), 'windows'], {
      env: { ...process.env, GITHUB_ENV: join(root, 'github-env') },
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('location');
  });
});
