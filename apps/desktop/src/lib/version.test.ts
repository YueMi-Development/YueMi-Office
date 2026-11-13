import { describe, expect, it } from 'vitest';

import rootPackage from '../../../../package.json?raw';
import desktopPackage from '../../../../apps/desktop/package.json?raw';
import protocolPackage from '../../../../packages/protocol/package.json?raw';
import tauriConfig from '../../../../apps/desktop/src-tauri/tauri.conf.json?raw';
import cargoToml from '../../../../apps/desktop/src-tauri/Cargo.toml?raw';
import cargoLock from '../../../../apps/desktop/src-tauri/Cargo.lock?raw';
import bunLock from '../../../../bun.lock?raw';
import apiPyproject from '../../../../apps/api/pyproject.toml?raw';
import apiInit from '../../../../apps/api/app/__init__.py?raw';
import apiMain from '../../../../apps/api/app/main.py?raw';
import {
  applyVersion,
  isPrereleaseTag,
  macosBundleVersion,
  parseVersion,
  setBunLockVersion,
  setCargoLockVersion,
  setCargoVersion,
  setFastApiVersion,
  setPackageVersion,
  setPyprojectVersion,
  setPythonVersion,
  setTauriVersion,
  versionFromTag,
  versionInFile,
  versionInFiles,
  versionsInFiles,
  wixVersion,
  type VersionFiles,
} from './version';

/**
 * The version of a release.
 *
 * The version is decided by the tag that is pushed, and it has to end up
 * in several files that the toolchains read. Two of the bundle formats
 * cannot take a pre-release identifier as it is, so the version they are
 * given has the identifier taken out of it.
 */

/** The version files as they are in the tree. */
function treeFiles(): VersionFiles {
  return {
    rootPackage,
    desktopPackage,
    protocolPackage,
    tauriConfig,
    cargoToml,
    cargoLock,
    bunLock,
    apiPyproject,
    apiInit,
    apiMain,
  };
}

describe('the version a tag names', () => {
  it('is the tag without the v', () => {
    expect(versionFromTag('v1.0.0')).toBe('1.0.0');
    expect(versionFromTag('v1.0.0-beta')).toBe('1.0.0-beta');
    expect(versionFromTag('v2.10.3-rc.1')).toBe('2.10.3-rc.1');
  });

  it('is refused when the tag names no version', () => {
    expect(versionFromTag('v1.0')).toBeNull();
    expect(versionFromTag('1.0.0')).toBeNull();
    expect(versionFromTag('release-1.0.0')).toBeNull();
    expect(versionFromTag('')).toBeNull();
  });

  it('knows a pre-release from a release', () => {
    expect(isPrereleaseTag('v1.0.0')).toBe(false);
    expect(isPrereleaseTag('v1.0.0-beta')).toBe(true);
    expect(isPrereleaseTag('v1.0.0-rc.1')).toBe(true);
  });
});

describe('a version', () => {
  it('is split into the parts the bundle formats need', () => {
    expect(parseVersion('1.0.0')).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: '',
      build: '',
    });

    expect(parseVersion('1.2.3-beta.4')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: 'beta.4',
      build: '',
    });
  });

  it('is refused when it is not one', () => {
    expect(parseVersion('1.0')).toBeNull();
    expect(parseVersion('v1.0.0')).toBeNull();
    expect(parseVersion('one')).toBeNull();
  });

  it('gives the Windows installer a version of numbers', () => {
    // WiX takes four numbers and no letters.
    expect(wixVersion(parseVersion('1.0.0')!)).toBe('1.0.0.0');
    expect(wixVersion(parseVersion('1.0.0-beta')!)).toBe('1.0.0.0');
  });

  it('gives macOS a build version of numbers', () => {
    expect(macosBundleVersion(parseVersion('1.0.0')!)).toBe('1.0.0');
    expect(macosBundleVersion(parseVersion('1.0.0-beta')!)).toBe('1.0.0');
  });
});

describe('writing the version into the files', () => {
  it('changes the version of a Cargo.toml', () => {
    const contents = setCargoVersion(
      ['[package]', 'name = "app"', 'version = "0.1.0"', ''].join('\n'),
      '1.0.0-beta',
    );

    expect(contents).toContain('version = "1.0.0-beta"');
    expect(contents).toContain('name = "app"');
  });

  it('leaves the dependencies of a Cargo.toml alone', () => {
    const contents = setCargoVersion(
      [
        '[package]',
        'version = "0.1.0"',
        '',
        '[dependencies]',
        'version = "not this one"',
      ].join('\n'),
      '1.0.0',
    );

    expect(contents).toContain('version = "not this one"');
  });

  it('changes the version of a package.json', () => {
    const contents = setPackageVersion('{"name": "x", "version": "0.1.0"}\n', '1.0.0');

    expect(JSON.parse(contents).version).toBe('1.0.0');
    expect(JSON.parse(contents).name).toBe('x');
  });

  it('changes the version of a tauri.conf.json and the two bundle formats', () => {
    const contents = setTauriVersion(
      JSON.stringify({
        version: '0.1.0',
        bundle: { active: true, icons: [] },
      }),
      parseVersion('1.0.0-beta')!,
    );

    const parsed = JSON.parse(contents);

    expect(parsed.version).toBe('1.0.0-beta');
    expect(parsed.bundle.windows.wix.version).toBe('1.0.0.0');
    expect(parsed.bundle.macOS.bundleVersion).toBe('1.0.0');
    expect(parsed.bundle.active).toBe(true);
  });

  it('puts the version into every file that carries one', () => {
    const updated = applyVersion(treeFiles(), '1.0.0-beta');

    expect(JSON.parse(updated.rootPackage).version).toBe('1.0.0-beta');
    expect(JSON.parse(updated.desktopPackage).version).toBe('1.0.0-beta');
    expect(JSON.parse(updated.protocolPackage).version).toBe('1.0.0-beta');
    expect(JSON.parse(updated.tauriConfig).version).toBe('1.0.0-beta');
    expect(updated.cargoToml).toContain('version = "1.0.0-beta"');
    expect(updated.cargoLock).toContain('version = "1.0.0-beta"');
    expect(updated.apiPyproject).toContain('version = "1.0.0-beta"');
    expect(updated.apiInit).toContain('__version__ = "1.0.0-beta"');
    expect(updated.apiMain).toContain('version="1.0.0-beta"');
  });

  it('refuses a version that is not one', () => {
    expect(() => applyVersion(treeFiles(), '1.0')).toThrow(/Not a version/);
  });
});

describe('writing the version into the render service', () => {
  it('changes the version of a pyproject.toml', () => {
    const contents = setPyprojectVersion(
      [
        '[build-system]',
        'requires = ["setuptools>=68"]',
        '',
        '[project]',
        'name = "yuemi-api"',
        'version = "0.1.0"',
        'dependencies = [',
        '  "weasyprint==70.0",',
        ']',
      ].join('\n'),
      '1.0.0',
    );

    expect(contents).toContain('version = "1.0.0"');
    expect(contents).toContain('name = "yuemi-api"');
  });

  it('leaves the pinned dependencies of a pyproject.toml alone', () => {
    // Some of the dependencies are pinned exactly, because they decide
    // the bytes of the PDF. A rewrite that did not stop at the table
    // would unpin them.
    const contents = setPyprojectVersion(
      [
        '[project]',
        'version = "0.1.0"',
        'dependencies = [',
        '  "weasyprint==70.0",',
        ']',
      ].join('\n'),
      '1.0.0',
    );

    expect(contents).toContain('"weasyprint==70.0"');
  });

  it('changes the __version__ of a module', () => {
    const contents = setPythonVersion(
      ['__version__ = "0.1.0"', '', 'OTHER = "not the version"'].join('\n'),
      '1.0.0',
    );

    expect(contents).toContain('__version__ = "1.0.0"');
    expect(contents).toContain('OTHER = "not the version"');
  });

  it('refuses a module that has no __version__', () => {
    expect(() => setPythonVersion('OTHER = "1.0.0"', '1.0.0')).toThrow(
      /no __version__/,
    );
  });

  it('changes the version of the FastAPI application', () => {
    const contents = setFastApiVersion(
      [
        'app = FastAPI(',
        '    title="yuemi Render Service",',
        '    version="0.1.0",',
        '    description="Renders projects.",',
        ')',
      ].join('\n'),
      '1.0.0',
    );

    expect(contents).toContain('version="1.0.0"');
    expect(contents).toContain('title="yuemi Render Service"');
  });

  it('refuses a file that has no FastAPI application', () => {
    expect(() => setFastApiVersion('app = 1', '1.0.0')).toThrow(
      /no FastAPI application/,
    );
  });
});

describe('writing the version into the lockfile', () => {
  it('changes the version of this crate', () => {
    const contents = setCargoLockVersion(
      [
        '[[package]]',
        'name = "anyhow"',
        'version = "1.0.104"',
        '',
        '[[package]]',
        'name = "app"',
        'version = "0.1.0"',
        'dependencies = [',
        ' "log",',
        ']',
      ].join('\n'),
      '1.0.0',
    );

    expect(contents).toContain('name = "app"\nversion = "1.0.0"');
  });

  it('leaves the versions of the crates it depends on alone', () => {
    const contents = setCargoLockVersion(
      [
        '[[package]]',
        'name = "anyhow"',
        'version = "1.0.104"',
        '',
        '[[package]]',
        'name = "app"',
        'version = "0.1.0"',
      ].join('\n'),
      '1.0.0',
    );

    expect(contents).toContain('version = "1.0.104"');
  });

  it('refuses a lockfile that has no package of ours', () => {
    expect(() => setCargoLockVersion('[[package]]\nname = "log"\n', '1.0.0')).toThrow(
      /no app package/,
    );
  });
});

describe('writing the version into the JavaScript lockfile', () => {
  it('changes the version of the workspace packages', () => {
    const contents = setBunLockVersion(
      [
        '{',
        '  "workspaces": {',
        '    "": {',
        '      "name": "yuemi-office",',
        '    },',
        '    "apps/desktop": {',
        '      "name": "@yuemi/desktop",',
        '      "version": "0.1.0",',
        '    },',
        '  },',
        '  "packages": {',
        '    "path-data-parser": ["path-data-parser@0.1.0", "", {}],',
        '  },',
        '}',
      ].join('\n'),
      '1.0.0',
    );

    expect(contents).toContain('"version": "1.0.0"');
  });

  it('leaves the versions of the dependencies alone', () => {
    // The lockfile records the versions of every package the workspace
    // depends on, and those are not ours to change.
    const contents = setBunLockVersion(
      [
        '{',
        '  "workspaces": {',
        '    "apps/desktop": {',
        '      "version": "0.1.0",',
        '    },',
        '  },',
        '  "packages": {',
        '    "path-data-parser": ["path-data-parser@0.1.0", "", {}],',
        '  },',
        '}',
      ].join('\n'),
      '1.0.0',
    );

    expect(contents).toContain('path-data-parser@0.1.0');
  });

  it('refuses a lockfile that has no workspaces table', () => {
    expect(() => setBunLockVersion('{ "packages": {} }', '1.0.0')).toThrow(
      /no workspaces table/,
    );
  });
});

describe('the version in the tree', () => {
  it('is the same in every file that carries one', () => {
    // A tree where the installer says one version and the package says
    // another is a tree that installs the wrong thing.
    const version = versionInFiles(treeFiles());

    expect(version).not.toBeNull();
    expect(version).toBe('0.1.0');
  });

  it('is the version the lockfile records', () => {
    // The lockfile records the version of the workspace packages, and a
    // lockfile that records another one is a lockfile that has to be
    // written again before the build.
    const version = versionInFiles(treeFiles());
    const recorded = bunLock.match(/"version": "[^"]+"/g) ?? [];

    // Both workspace packages that carry a version carry this one.
    expect(recorded.length).toBeGreaterThan(0);
    for (const entry of recorded) {
      expect(entry).toBe(`"version": "${version}"`);
    }
  });

  it('is the version the bundle formats are given', () => {
    const config = JSON.parse(tauriConfig);
    const version = parseVersion(config.version);

    expect(version).not.toBeNull();
    expect(config.bundle.windows.wix.version).toBe(wixVersion(version!));
    expect(config.bundle.macOS.bundleVersion).toBe(macosBundleVersion(version!));
  });

  it('is the version every project of the tree declares', () => {
    // The render service is a separate project with a version of its
    // own, and it is released together with the desktop app, so it
    // carries the same number.
    const versions = versionsInFiles(treeFiles());

    for (const version of Object.values(versions)) {
      expect(version).toBe('0.1.0');
    }
  });

  it('is read out of each kind of file', () => {
    const files = treeFiles();

    expect(versionInFile('rootPackage', files.rootPackage)).toBe('0.1.0');
    expect(versionInFile('cargoToml', files.cargoToml)).toBe('0.1.0');
    expect(versionInFile('cargoLock', files.cargoLock)).toBe('0.1.0');
    expect(versionInFile('apiPyproject', files.apiPyproject)).toBe('0.1.0');
    expect(versionInFile('apiInit', files.apiInit)).toBe('0.1.0');
    expect(versionInFile('apiMain', files.apiMain)).toBe('0.1.0');
  });

  it('is null when a file has no version in it', () => {
    // A file that was written wrongly is reported rather than skipped,
    // because a skipped file is a file that ships the wrong number.
    expect(versionInFile('apiInit', 'OTHER = "1.0.0"')).toBeNull();
    expect(versionInFile('apiMain', 'app = 1')).toBeNull();
    expect(versionInFile('cargoLock', '[[package]]\nname = "log"\n')).toBeNull();
  });
});
