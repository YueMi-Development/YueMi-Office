import { describe, expect, it } from 'vitest';

import ci from '../../../../.github/workflows/ci.yml?raw';
import tauriConfig from '../../../../apps/desktop/src-tauri/tauri.conf.json?raw';
import iconsGitignore from '../../../../apps/desktop/src-tauri/icons/.gitignore?raw';
import generator from '../../../../scripts/generate-icons.ts?raw';

/**
 * The icons of the app.
 *
 * The icons are not kept in the repository. They are derived from one
 * picture, so a tree that carried them would carry fifteen files that
 * have to be changed together with that picture, and nothing would stop
 * them from falling behind it.
 *
 * Deriving them has a cost: the Rust side of the app reads the icon of
 * the window into the binary, and the bundler of every platform reads
 * its own file out of the same folder. A compile without them fails, so
 * the icons have to be written before the Rust side is compiled, not
 * only before the installers are made.
 *
 * So the rule is checked here: the icons are derived, the derivation
 * happens before the compile, and the picture they come from is in the
 * repository.
 */

/** The Tauri configuration, as the file reads it. */
function config(): {
  build: { beforeBuildCommand?: string; beforeDevCommand?: string };
  bundle: { icon?: string[] };
} {
  return JSON.parse(tauriConfig);
}

/** The names of the steps of a job in the CI workflow. */
function stepNames(job: string): string[] {
  const lines = ci.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${job}:`);

  if (start === -1) {
    return [];
  }

  const names: string[] = [];

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^ {2}\S/.test(line)) {
      break;
    }

    const match = line.match(/^ {6}- name: (.+)$/);

    if (match) {
      names.push(match[1].trim());
    }
  }

  return names;
}

describe('the icons of the app', () => {
  it('are not kept in the repository', () => {
    // The folder of the icons holds generated files. The rule that keeps
    // them out is a `*` that ignores everything in the folder.
    expect(iconsGitignore).toMatch(/^\*/m);
  });

  it('keep the rule that ignores them', () => {
    // The order matters. A `!.gitignore` written before the `*` is
    // overridden by the `*`, so the file that holds the rule would be
    // ignored by its own rule, and the folder would be invisible to
    // Git.
    const lines = iconsGitignore.split(/\r?\n/).filter(Boolean);

    expect(lines[0]).toBe('*');
    expect(lines[1]).toBe('!.gitignore');
  });

  it('are made from one picture in the repository', () => {
    // The picture is the one thing that is kept, because a picture
    // cannot be derived from anything smaller than itself.
    expect(generator).toContain('.github/assets/Logo.png');
  });

  it('are written before the build', () => {
    // The bundler of every platform reads its icon out of the folder,
    // so the icons have to be there before the bundler runs.
    expect(config().build.beforeBuildCommand).toContain('icons');
  });

  it('are written before the development run', () => {
    // The development run compiles the Rust side too, and that compile
    // reads the icon of the window into the binary.
    expect(config().build.beforeDevCommand).toContain('icons');
  });

  it('are written before the Rust tests are run', () => {
    // The Rust job runs `cargo test` directly rather than through the
    // Tauri CLI, so the hook of the CLI does not run for it, and the
    // icons have to be written by the workflow itself.
    const names = stepNames('rust');

    expect(names).toContain('Write the icons');
    expect(names.indexOf('Write the icons')).toBeLessThan(
      names.indexOf('Run cargo tests'),
    );
  });

  it('are the ones the bundler is told to use', () => {
    // The configuration names the files of the folder. A file that is
    // named here and not written by the generator is a file the bundler
    // would ask for and not find.
    //
    // The names are the ones the Tauri CLI writes, because the CLI is
    // what writes them. The list is the CLI's own, and the CLI is the
    // only thing that knows it.
    const written = [
      '32x32.png',
      '64x64.png',
      '128x128.png',
      '128x128@2x.png',
      'icon.png',
      'icon.ico',
      'icon.icns',
    ];

    for (const icon of config().bundle.icon ?? []) {
      const name = icon.replace(/^icons\//, '');

      expect(written).toContain(name);
    }
  });
});
