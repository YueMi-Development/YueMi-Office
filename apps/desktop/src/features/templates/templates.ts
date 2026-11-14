import type { Project } from '@yuemi/protocol';

import { PROJECT_SCHEMA_VERSION } from '../../lib/project';

import templateContent from './content.json';

/**
 * The documents a new project can start from.
 *
 * A template is an ordinary project: a `project.json`, some Typst files, a
 * theme file and the fonts it uses. Keeping it in that shape means a
 * template creates a folder the app can open straight away, with no import
 * step and nothing to convert later.
 *
 * The text of the files lives in `content.json` rather than in this module,
 * so the tests can read the same files the app writes.
 */

export interface TemplateFile {
  /** Path relative to the project root, with forward slashes. */
  path: string;
  /** The file's text contents. */
  text: string;
}

export interface TemplateFont {
  /** Path the font will have inside the new project. */
  path: string;
  /** Where the font comes from inside the app bundle. */
  source: string;
}

export interface DocumentTemplate {
  /** Stable identifier, used to tell templates apart. */
  id: string;
  /** The name shown in the template list. */
  name: string;
  /** One line describing what the template is for. */
  description: string;
  /** The project file written into the new folder. */
  project: Project;
  /** The Typst and theme files written into the new folder. */
  files: TemplateFile[];
  /** The fonts copied into the new folder. */
  fonts: TemplateFont[];
}

/**
 * Where the bundled fonts live inside the app.
 *
 * The files are copied into the new project rather than referenced, so the
 * project stays self-contained and renders the same way on any machine.
 */
export const BUNDLED_FONT_URLS = {
  interRegular: '/fonts/inter-400.woff2',
  interBold: '/fonts/inter-700.woff2',
  serifRegular: '/fonts/source-serif-4-400.woff2',
  serifItalic: '/fonts/source-serif-4-400-italic.woff2',
} as const;

interface TemplateDefinition {
  name: string;
  description: string;
  files: Record<string, string>;
  fonts: TemplateFont[];
}

function buildTemplate(id: string, definition: TemplateDefinition): DocumentTemplate {
  const files: TemplateFile[] = Object.entries(definition.files).map(
    ([path, text]) => ({ path, text }),
  );

  // The theme is the file named `theme.typ`, either at the root of the
  // project or in a folder of its own. Everything else that ends in
  // `.typ` is part of the document.
  const themePath =
    files.find((file) => /(^|\/)theme\.typ$/.test(file.path))?.path ?? null;

  const content = files
    .map((file) => file.path)
    .filter((path) => path.endsWith('.typ') && path !== themePath);

  const project: Project = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    title: definition.name,
    language: 'en',
    content,
    theme: themePath,
    fonts: definition.fonts.map((font) => font.path),
    assetsDir: 'assets',
    page: { size: 'A4', orientation: 'portrait' },
    pdf: { variant: null },
  };

  return {
    id,
    name: definition.name,
    description: definition.description,
    project,
    files,
    fonts: definition.fonts,
  };
}

/**
 * The templates the app offers, in the order they are shown.
 */
export const DOCUMENT_TEMPLATES: DocumentTemplate[] = Object.entries(
  templateContent as Record<string, TemplateDefinition>,
).map(([id, definition]) => buildTemplate(id, definition));

/**
 * Finds a template by its identifier.
 */
export function findTemplate(id: string): DocumentTemplate | undefined {
  return DOCUMENT_TEMPLATES.find((template) => template.id === id);
}
