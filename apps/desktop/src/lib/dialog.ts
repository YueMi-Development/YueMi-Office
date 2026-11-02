import { open, save } from '@tauri-apps/plugin-dialog';

import { isTauri } from './tauri';

/**
 * Asks the user to pick a project folder.
 *
 * Returns null when the dialog is cancelled or when the app is not running
 * inside the Tauri shell.
 */
export async function pickProjectFolder(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Open document project',
  });
  if (typeof selected === 'string') {
    return selected;
  }
  return null;
}

/**
 * Asks the user where to save an exported file.
 *
 * Returns null when the dialog is cancelled.
 */
export async function pickSavePath(
  defaultPath: string,
  filters?: { name: string; extensions: string[] }[],
): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }
  const selected = await save({ defaultPath, filters });
  return selected ?? null;
}
