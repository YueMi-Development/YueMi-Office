import { createProject, type ProjectFileToWrite } from '../../lib/files';
import { serializeProject } from '../../lib/project';
import type { DocumentTemplate } from './templates';

/**
 * Turning a template into a project on disk.
 *
 * The files are written as they are, and the fonts are copied in rather than
 * referenced, so the new folder is complete on its own and renders the same
 * way on any machine.
 */

/**
 * Reads a bundled font and encodes it for writing to disk.
 */
async function readBundledFont(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Cannot read the bundled font ${url}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * The files a template writes into a new project.
 */
export async function buildTemplateFiles(
  template: DocumentTemplate,
): Promise<ProjectFileToWrite[]> {
  const files: ProjectFileToWrite[] = template.files.map((file) => ({
    path: file.path,
    text: file.text,
  }));

  for (const font of template.fonts) {
    files.push({
      path: font.path,
      base64: await readBundledFont(font.source),
    });
  }

  return files;
}

/**
 * Writes a template into a folder and returns the files it created.
 */
export async function createProjectFromTemplate(
  rootPath: string,
  template: DocumentTemplate,
): Promise<void> {
  const files = await buildTemplateFiles(template);
  await createProject(rootPath, template.project, files);
}

/**
 * The project file a template writes, as it would appear on disk.
 */
export function templateProjectFile(template: DocumentTemplate): string {
  return serializeProject(template.project);
}
