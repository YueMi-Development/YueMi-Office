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
 * - the render service is a Python package, so its version is in a
 *   `pyproject.toml` and in the two places the service itself reports it.
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
  cargoLock: 'apps/desktop/src-tauri/Cargo.lock',
  bunLock: 'bun.lock',
  apiPyproject: 'apps/api/pyproject.toml',
  apiInit: 'apps/api/app/__init__.py',
  apiMain: 'apps/api/app/main.py',
} as const;

/** Which of the version files this is. */
export type VersionFileKey = keyof typeof VERSION_FILES;

/** The contents of the version files. */
export type VersionFiles = Record<VersionFileKey, string>;

/**
 * The project each version file belongs to.
 *
 * A tree has more than one version in it, and a report that says which
 * project each number belongs to is worth more than a list of paths.
 */
export const VERSION_PROJECTS: Record<VersionFileKey, string> = {
  rootPackage: 'the repository',
  desktopPackage: 'the desktop app',
  protocolPackage: 'the protocol package',
  tauriConfig: 'the desktop app',
  cargoToml: 'the desktop app',
  cargoLock: 'the desktop app',
  bunLock: 'the repository',
  apiPyproject: 'the render service',
  apiInit: 'the render service',
  apiMain: 'the render service',
};

/**
 * The name of the crate whose version the lockfile carries.
 *
 * The lockfile holds the version of every crate in the tree, and only the
 * one of this crate is ours to change.
 */
const CRATE_NAME = 'app';

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
  return setTableVersion(contents, '[package]', version);
}

/**
 * Writes a version into a `pyproject.toml`.
 *
 * Only the version of the project itself is changed, the way the Cargo
 * manifest is left alone outside its own table. The dependencies have
 * versions of their own, and some of them are pinned exactly, so a
 * rewrite that did not stop at the table would unpin them.
 */
export function setPyprojectVersion(contents: string, version: string): string {
  return setTableVersion(contents, '[project]', version);
}

/**
 * Writes a version into the version line of a table.
 *
 * The table is found by its header, and the line is found inside it, so
 * that a `version` of a dependency or of another table is left alone.
 */
function setTableVersion(
  contents: string,
  table: string,
  version: string,
): string {
  const lines = contents.split('\n');
  let inTable = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (line.startsWith('[')) {
      inTable = line === table;
      continue;
    }

    if (inTable && /^version\s*=/.test(line)) {
      lines[index] = `version = "${version}"`;
      return lines.join('\n');
    }
  }

  throw new Error(`The ${table} table has no version.`);
}

/**
 * Writes a version into a Python module's `__version__`.
 *
 * The name is looked for rather than a line, because a module may hold
 * other assignments and they are not the version.
 */
export function setPythonVersion(contents: string, version: string): string {
  const pattern = /^(__version__\s*=\s*)["'][^"']*["']/m;

  if (!pattern.test(contents)) {
    throw new Error('The module has no __version__.');
  }

  return contents.replace(pattern, `$1"${version}"`);
}

/**
 * Writes a version into the `FastAPI(...)` call of the service.
 *
 * The call is found first and the version is looked for inside it, so
 * that another version further down the file is not touched.
 */
export function setFastApiVersion(contents: string, version: string): string {
  const start = contents.indexOf('FastAPI(');

  if (start === -1) {
    throw new Error('The service has no FastAPI application.');
  }

  const end = contents.indexOf('\n)', start);

  if (end === -1) {
    throw new Error('The FastAPI application is not closed.');
  }

  const call = contents.slice(start, end);
  const pattern = /(version\s*=\s*)["'][^"']*["']/;

  if (!pattern.test(call)) {
    throw new Error('The FastAPI application has no version.');
  }

  return (
    contents.slice(0, start) +
    call.replace(pattern, `$1"${version}"`) +
    contents.slice(end)
  );
}

/**
 * Writes a version into a `Cargo.lock`.
 *
 * The lockfile holds the version of every crate in the tree. Only the
 * block of this crate is changed, and it is found by its name rather
 * than by a loose match, so the versions of the crates it depends on
 * are left alone.
 */
export function setCargoLockVersion(contents: string, version: string): string {
  const blocks = contents.split(/(?=\[\[package\]\])/);

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];

    if (!new RegExp(`^name = "${CRATE_NAME}"$`, 'm').test(block)) {
      continue;
    }

    const pattern = /^(version\s*=\s*)"[^"]*"/m;

    if (!pattern.test(block)) {
      throw new Error(`The ${CRATE_NAME} package in Cargo.lock has no version.`);
    }

    blocks[index] = block.replace(pattern, `$1"${version}"`);

    return blocks.join('');
  }

  throw new Error(`Cargo.lock has no ${CRATE_NAME} package.`);
}

/**
 * Writes a version into a `bun.lock`.
 *
 * The lockfile records the version of the workspace packages, and those
 * are the only versions in it that are ours to change. The versions of
 * the packages the workspace depends on are written in another shape, so
 * only the ones inside the `workspaces` table are rewritten.
 */
export function setBunLockVersion(contents: string, version: string): string {
  const start = contents.indexOf('"workspaces": {');
  const end = contents.indexOf('"packages": {');

  if (start === -1 || end === -1 || end < start) {
    throw new Error('The lockfile has no workspaces table.');
  }

  const before = contents.slice(0, start);
  const table = contents.slice(start, end);
  const after = contents.slice(end);

  const rewritten = table.replace(
    /^(\s*)"version": "[^"]*"/gm,
    `$1"version": "${version}"`,
  );

  if (!/"version":/.test(table)) {
    throw new Error('The workspaces table of the lockfile has no version.');
  }

  return before + rewritten + after;
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
    cargoLock: setCargoLockVersion(files.cargoLock, version),
    bunLock: setBunLockVersion(files.bunLock, version),
    apiPyproject: setPyprojectVersion(files.apiPyproject, version),
    apiInit: setPythonVersion(files.apiInit, version),
    apiMain: setFastApiVersion(files.apiMain, version),
  };
}

/**
 * The version one file carries.
 *
 * Returns null when the file has no version in it, or when the version
 * cannot be found, so that a file which was written wrongly is reported
 * rather than skipped.
 */
export function versionInFile(
  key: VersionFileKey,
  contents: string,
): string | null {
  switch (key) {
    case 'cargoToml':
      return tableVersion(contents, '[package]');
    case 'cargoLock':
      return lockVersion(contents);
    case 'apiPyproject':
      return tableVersion(contents, '[project]');
    case 'bunLock': {
      const versions = workspaceVersions(contents);

      if (versions.length === 0) {
        return null;
      }

      // The workspace packages carry one version between them. If they
      // do not, the lockfile is a lockfile that has to be written again.
      return new Set(versions).size === 1 ? versions[0] : null;
    }
    case 'apiInit': {
      const match = /^__version__\s*=\s*["']([^"']*)["']/m.exec(contents);

      return match ? match[1] : null;
    }
    case 'apiMain': {
      const start = contents.indexOf('FastAPI(');
      const end = start === -1 ? -1 : contents.indexOf('\n)', start);

      if (start === -1 || end === -1) {
        return null;
      }

      const match = /version\s*=\s*["']([^"']*)["']/.exec(
        contents.slice(start, end),
      );

      return match ? match[1] : null;
    }
    default: {
      const parsed = JSON.parse(contents) as Record<string, unknown>;

      return typeof parsed.version === 'string' ? parsed.version : null;
    }
  }
}

/**
 * The version of a table of a TOML file.
 *
 * The table is found by its header, so a `version` of a dependency or of
 * another table is not the one that is read.
 */
function tableVersion(contents: string, table: string): string | null {
  const lines = contents.split('\n');
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('[')) {
      inTable = trimmed === table;
      continue;
    }

    if (inTable) {
      const match = /^version\s*=\s*"([^"]*)"/.exec(trimmed);

      if (match) {
        return match[1];
      }
    }
  }

  return null;
}

/**
 * The versions the workspace packages of a lockfile record.
 *
 * Only the versions inside the `workspaces` table are ours. The versions
 * of the packages the workspace depends on are written in another shape,
 * and they are not ours to change.
 */
function workspaceVersions(contents: string): string[] {
  const start = contents.indexOf('"workspaces": {');
  const end = contents.indexOf('"packages": {');

  if (start === -1 || end === -1 || end < start) {
    return [];
  }

  const table = contents.slice(start, end);

  return [...table.matchAll(/"version": "([^"]*)"/g)].map((match) => match[1]);
}

/**
 * The version of this crate in a `Cargo.lock`.
 */
function lockVersion(contents: string): string | null {
  const blocks = contents.split(/(?=\[\[package\]\])/);

  for (const block of blocks) {
    if (!new RegExp(`^name = "${CRATE_NAME}"$`, 'm').test(block)) {
      continue;
    }

    const match = /^version\s*=\s*"([^"]*)"/m.exec(block);

    return match ? match[1] : null;
  }

  return null;
}

/**
 * The version every file of the tree carries.
 *
 * A tree where the installer says one version and the package says
 * another is a tree that installs the wrong thing, so the versions have
 * to agree.
 */
export function versionInFiles(files: VersionFiles): string | null {
  const versions = new Set<string>();

  for (const key of Object.keys(VERSION_FILES) as VersionFileKey[]) {
    const version = versionInFile(key, files[key]);

    versions.add(version ?? '');
  }

  return versions.size === 1 ? [...versions][0] : null;
}

/**
 * The version each file of the tree carries.
 *
 * A report needs to say which file says what, so that a tree whose
 * declarations disagree can be pointed at the file that is the odd one
 * out.
 */
export function versionsInFiles(
  files: VersionFiles,
): Record<VersionFileKey, string | null> {
  const versions = {} as Record<VersionFileKey, string | null>;

  for (const key of Object.keys(VERSION_FILES) as VersionFileKey[]) {
    versions[key] = versionInFile(key, files[key]);
  }

  return versions;
}
