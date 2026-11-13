/**
 * The version of the app, and the files that carry it.
 *
 * The version of a release is decided by the tag that is pushed, and the
 * tag is a semver version with a `v` in front of it. The build then has to
 * put that version into the places the toolchains look at it, and the
 * places do not agree:
 *
 * - `tauri.conf.json` is what the Tauri CLI and the bundler read.
 * - `Cargo.toml` is what cargo reads.
 * - the `package.json` files are what bun reads, and the lockfile records
 *   their versions too.
 *
 * Two of the bundle formats want a version that is not the semver one.
 * The Windows installer is built by WiX, whose version has four numbers
 * and no letters, and macOS wants a plain number for the build version.
 * A pre-release such as `1.0.0-beta` is a valid semver version and is
 * what the file names and the release page show, so it is kept in the
 * places that accept it and taken out of the two places that do not.
 */

/** The files that carry the version. */
export const VERSION_FILES = {
  rootPackage: 'package.json',
  desktopPackage: 'apps/desktop/package.json',
  protocolPackage: 'packages/protocol/package.json',
  tauriConfig: 'apps/desktop/src-tauri/tauri.conf.json',
  cargoToml: 'apps/desktop/src-tauri/Cargo.toml',
} as const;

/** Which of the version files this is. */
export type VersionFileKey = keyof typeof VERSION_FILES;

/** The contents of the version files. */
export type VersionFiles = Record<VersionFileKey, string>;

/** A version, split into the parts the bundle formats need. */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  /** The pre-release identifier, without the dash. Empty for a stable version. */
  prerelease: string;
  /** The build metadata, without the plus. Empty when there is none. */
  build: string;
}

/**
 * A semver version.
 *
 * The numbers are the ones the format asks for, and the pre-release and
 * build metadata are the parts after the version and after the plus.
 */
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

/** A tag that names a release: a `v` and a semver version. */
const RELEASE_TAG = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

/**
 * Parses a version.
 *
 * Returns null when the text is not a version, rather than throwing, so
 * that a caller can report the text it was given.
 */
export function parseVersion(text: string): SemVer | null {
  const match = SEMVER.exec(text.trim());

  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? '',
    build: match[5] ?? '',
  };
}

/**
 * The version a release tag names.
 *
 * The tag is `v` and a version, and nothing else. A tag such as `v1.0` or
 * `release-1.0.0` names no version, and is refused here rather than
 * halfway through the build.
 */
export function versionFromTag(tag: string): string | null {
  const match = RELEASE_TAG.exec(tag.trim());

  if (!match) {
    return null;
  }

  return match[1];
}

/**
 * Whether a tag names a pre-release.
 *
 * A pre-release is a version with a dash in it, such as `v1.0.0-beta`.
 * GitHub shows those as pre-releases rather than as releases, so that
 * they do not look like the finished thing.
 */
export function isPrereleaseTag(tag: string): boolean {
  return tag.trim().includes('-');
}

/**
 * The version the Windows installer is built with.
 *
 * WiX takes four numbers and no letters, so a pre-release identifier is
 * dropped and the fourth number is left at zero.
 */
export function wixVersion(version: SemVer): string {
  return `${version.major}.${version.minor}.${version.patch}.0`;
}

/**
 * The version macOS records as the build version.
 *
 * Apple wants a plain number here, and the short version that sits
 * beside it carries the pre-release identifier.
 */
export function macosBundleVersion(version: SemVer): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/**
 * Writes a version into a `Cargo.toml`.
 *
 * Only the version of the package itself is changed. The dependencies
 * have versions of their own, and those are left alone.
 */
export function setCargoVersion(contents: string, version: string): string {
  const lines = contents.split('\n');
  let inPackage = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (line.startsWith('[')) {
      inPackage = line === '[package]';
      continue;
    }

    if (inPackage && /^version\s*=/.test(line)) {
      lines[index] = `version = "${version}"`;
      return lines.join('\n');
    }
  }

  throw new Error('The [package] table of Cargo.toml has no version.');
}

/**
 * Writes a version into a `package.json`.
 */
export function setPackageVersion(contents: string, version: string): string {
  const parsed = JSON.parse(contents) as Record<string, unknown>;

  parsed.version = version;

  return `${JSON.stringify(parsed, null, 2)}\n`;
}

/**
 * Writes a version into a `tauri.conf.json`.
 *
 * The version itself is the semver one. The two bundle formats that
 * cannot take it are given the numbers they can take.
 */
export function setTauriVersion(contents: string, version: SemVer): string {
  const parsed = JSON.parse(contents) as Record<string, unknown>;

  parsed.version = `${version.major}.${version.minor}.${version.patch}${
    version.prerelease ? `-${version.prerelease}` : ''
  }${version.build ? `+${version.build}` : ''}`;

  const bundle = (parsed.bundle ?? {}) as Record<string, unknown>;

  const windows = (bundle.windows ?? {}) as Record<string, unknown>;
  const wix = (windows.wix ?? {}) as Record<string, unknown>;
  wix.version = wixVersion(version);
  windows.wix = wix;
  bundle.windows = windows;

  const macos = (bundle.macOS ?? {}) as Record<string, unknown>;
  macos.bundleVersion = macosBundleVersion(version);
  bundle.macOS = macos;

  parsed.bundle = bundle;

  return `${JSON.stringify(parsed, null, 2)}\n`;
}

/**
 * Puts a version into every file that carries one.
 *
 * The files are taken as they are, and the new contents are returned, so
 * that the caller decides whether to write them to disk. That is what
 * lets the test suite check the result without touching the tree.
 */
export function applyVersion(files: VersionFiles, version: string): VersionFiles {
  const parsed = parseVersion(version);

  if (!parsed) {
    throw new Error(
      `Not a version: ${version}. A version is three numbers, an optional ` +
        'pre-release identifier and optional build metadata.',
    );
  }

  return {
    rootPackage: setPackageVersion(files.rootPackage, version),
    desktopPackage: setPackageVersion(files.desktopPackage, version),
    protocolPackage: setPackageVersion(files.protocolPackage, version),
    tauriConfig: setTauriVersion(files.tauriConfig, parsed),
    cargoToml: setCargoVersion(files.cargoToml, version),
  };
}

/**
 * The version the files of a tree carry.
 *
 * The files have to agree, because a tree where the installer says one
 * version and the package says another is a tree that installs the wrong
 * thing.
 */
export function versionInFiles(files: VersionFiles): string | null {
  const versions = new Set<string>();

  for (const key of Object.keys(VERSION_FILES) as VersionFileKey[]) {
    const contents = files[key];

    if (key === 'cargoToml') {
      const match = /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(contents);
      versions.add(match ? match[1] : '');
      continue;
    }

    const parsed = JSON.parse(contents) as Record<string, unknown>;
    versions.add(typeof parsed.version === 'string' ? parsed.version : '');
  }

  return versions.size === 1 ? [...versions][0] : null;
}
