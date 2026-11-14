import type { ProjectAsset, ProjectFont } from '@yuemi/protocol';

import { collectProjectBinaries } from './files';
import { isTauri } from './tauri';

/**
 * Loading the fonts and assets a project needs for a render.
 *
 * The renderer never touches the user's disk, so every binary file a
 * document refers to travels with the request. Fonts are named explicitly in
 * `project.json`, which is what makes a document render the same way on
 * every machine.
 */

/**
 * Reads the fonts and assets a project needs.
 *
 * Without a filesystem there is nothing to read, so an empty result is
 * returned and the document falls back to the machine's fonts.
 */
export async function loadProjectBinaries(
  rootPath: string | null,
  fontPaths: string[],
  assetsDir: string,
): Promise<{ fonts: ProjectFont[]; assets: ProjectAsset[] }> {
  if (!rootPath || !isTauri()) {
    return { fonts: [], assets: [] };
  }

  try {
    const binaries = await collectProjectBinaries(rootPath, fontPaths, assetsDir);
    return {
      fonts: binaries.fonts.map((font) => ({
        path: font.path,
        base64: font.base64,
        mimeType: font.mimeType,
      })),
      assets: binaries.assets.map((asset) => ({
        path: asset.path,
        base64: asset.base64,
        mimeType: asset.mimeType,
      })),
    };
  } catch {
    // A missing font or asset must not stop the preview from rendering; the
    // renderer reports it as a warning instead.
    return { fonts: [], assets: [] };
  }
}
