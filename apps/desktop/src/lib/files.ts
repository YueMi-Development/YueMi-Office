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
 * Reads a project folder.
 *
 * The Rust side does the filesystem work so the webview never needs broad
 * filesystem permissions.
 */
export async function openProject(rootPath: string): Promise<OpenProjectResult> {
  return invoke<OpenProjectResult>('open_project', { rootPath });
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
 * Joins a project's content files into one Markdown document.
 */
export function joinMarkdown(
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
