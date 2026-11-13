import { describe, expect, it } from 'vitest';

import rootPackage from '../../../../package.json?raw';
import desktopPackage from '../../../../apps/desktop/package.json?raw';
import protocolPackage from '../../../../packages/protocol/package.json?raw';
import tauriConfig from '../../../../apps/desktop/src-tauri/tauri.conf.json?raw';
import cargoToml from '../../../../apps/desktop/src-tauri/Cargo.toml?raw';
import lockfile from '../../../../bun.lock?raw';
import {
  applyVersion,
  isPrereleaseTag,
  macosBundleVersion,
  parseVersion,
  setCargoVersion,
  setPackageVersion,
  setTauriVersion,
  versionFromTag,
  versionInFiles,
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
  });

  it('refuses a version that is not one', () => {
    expect(() => applyVersion(treeFiles(), '1.0')).toThrow(/Not a version/);
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
    const recorded = lockfile.match(/"version": "[^"]+"/g) ?? [];

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
});
