import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauri';

/**
 * A file found in the project folder.
 */
export interface DiscoveredFile {
  /** Path relative to the project root, with forward slashes. */
  path: string;
  /** File contents, decoded as UTF-8. */
  text: string;
}

export interface OpenProjectResult {
  /** The parsed `project.json`. */
  project: unknown;
  /** Every text file in the project folder. */
  files: DiscoveredFile[];
}

/**
 * A binary file in the project folder.
 */
export interface DiscoveredBinaryFile {
  /** Path relative to the project root, with forward slashes. */
  path: string;
  /** Base64-encoded file contents. */
  base64: string;
  /** MIME type derived from the file extension. */
  mimeType: string;
}

/**
 * The fonts and assets of a project, ready to be inlined in a render request.
 */
export interface ProjectBinaries {
  fonts: DiscoveredBinaryFile[];
  assets: DiscoveredBinaryFile[];
}

/**
 * Reads a project folder.
 *
 * The Rust side does the filesystem work so the webview never needs broad
 * filesystem permissions.
 */
export async function openProject(rootPath: string): Promise<OpenProjectResult> {
  return invoke<OpenProjectResult>('open_project', { rootPath });
}

/**
 * Reads the project's bundled fonts and its assets.
 *
 * The fonts are the ones the project named, so a document only ever uses the
 * fonts it asked for. The assets are everything in the project's assets
 * folder.
 */
export async function collectProjectBinaries(
  rootPath: string,
  fontPaths: string[],
  assetsDir: string,
): Promise<ProjectBinaries> {
  return invoke<ProjectBinaries>('collect_project_binaries', {
    rootPath,
    fontPaths,
    assetsDir,
  });
}

/**
 * A file to write as part of a new project.
 */
export interface ProjectFileToWrite {
  /** Path relative to the project root, with forward slashes. */
  path: string;
  /** Text contents, for Typst source and theme files. */
  text?: string;
  /** Base64 contents, for font and image files. */
  base64?: string;
}

/**
 * Creates a new project folder and fills it with the given files.
 */
export async function createProject(
  rootPath: string,
  project: unknown,
  files: ProjectFileToWrite[],
): Promise<void> {
  await invoke('create_project', { rootPath, project, files });
}

/**
 * Writes a project's files back to disk.
 */
export async function saveProject(
  rootPath: string,
  project: unknown,
  files: Record<string, string>,
): Promise<void> {
  await invoke('save_project', { rootPath, project, files });
}

/**
 * Writes a single file to disk.
 */
export async function writeProjectFile(
  rootPath: string,
  path: string,
  text: string,
): Promise<void> {
  await invoke('write_project_file', { rootPath, path, text });
}

/**
 * Writes a file the user picked through a save dialog.
 */
export async function exportFile(
  path: string,
  contents: Uint8Array | string,
): Promise<void> {
  if (typeof contents === 'string') {
    await invoke('export_text_file', { path, contents });
  } else {
    await invoke('export_binary_file', { path, contents: Array.from(contents) });
  }
}

/**
 * Joins a project's content files into one Typst document.
 *
 * The result is a single file that renders the same way as the project, so
 * it can be handed to someone who does not have the folder.
 */
export function joinTypst(
  project: { content: string[] },
  files: Record<string, string>,
): string {
  return project.content
    .map((path) => files[path] ?? '')
    .filter((text) => text.length > 0)
    .join('\n\n');
}

/**
 * Whether the app is running inside a Tauri shell.
 */
export function canUseFilesystem(): boolean {
  return isTauri();
}
