/**
 * Shared contract between the desktop app and the render service.
 *
 * The render service is stateless: it receives a whole project and returns a
 * rendered PDF. Keeping the request fully self-describing means the service
 * never touches the user's disk, which is the boundary the AI assistant must
 * respect later (PRD section 7).
 */

/** Current version of the on-disk project format. */
export const PROJECT_SCHEMA_VERSION = 2;

/** Page sizes WeasyPrint understands. */
export const PAGE_SIZES = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'Letter', 'Legal', 'Tabloid'] as const;

export type PageSize = (typeof PAGE_SIZES)[number];

export type Orientation = 'portrait' | 'landscape';

export interface PageConfig {
  size: PageSize;
  orientation: Orientation;
}

/** PDF output flavour, e.g. `pdf/a-3b` for an archival variant. */
export type PdfVariant =
  | 'pdf/a-1b'
  | 'pdf/a-2b'
  | 'pdf/a-3b'
  | 'pdf/a-2u'
  | 'pdf/a-3u'
  | 'pdf/ua-1'
  | null;

/**
 * The `project.json` file that marks a folder as a document project.
 *
 * `content` and `styles` are explicit ordered lists rather than directory
 * globs: file order must not depend on the filesystem, otherwise the same
 * project would render differently on different operating systems and break
 * the cross-platform consistency guarantee (PRD section 8).
 */
export interface Project {
  schemaVersion: number;
  title: string;
  language: string;
  /** Content file paths relative to the project root, in document order. */
  content: string[];
  /** Stylesheet paths relative to the project root, in cascade order. */
  styles: string[];
  /**
   * Font files bundled with the project, relative to the project root.
   *
   * Bundling fonts keeps a document independent of what is installed on the
   * rendering machine, which is what makes the output identical on every
   * operating system (PRD section 8).
   */
  fonts?: string[];
  /** Directory holding images and other assets, relative to the project root. */
  assetsDir: string;
  page: PageConfig;
  pdf: { variant: PdfVariant };
}

/** A single text file (Markdown content or CSS) within a project. */
export interface ProjectFile {
  /** Path relative to the project root, using forward slashes. */
  path: string;
  text: string;
}

/** A binary asset within a project, inlined so the service stays stateless. */
export interface ProjectAsset {
  /** Path relative to the project root, using forward slashes. */
  path: string;
  /** Base64-encoded file contents. */
  base64: string;
  /** MIME type, e.g. `image/svg+xml`. */
  mimeType: string;
}

/** A font file bundled with the project. */
export interface ProjectFont {
  /** Path relative to the project root, using forward slashes. */
  path: string;
  base64: string;
  mimeType: string;
  /**
   * The font family name as declared inside the font file.
   *
   * The client leaves this empty and the service reads it from the font's
   * name table, so the CSS author can use the family's real name.
   */
  family?: string;
}

export interface RenderRequest {
  project: Project;
  files: ProjectFile[];
  assets: ProjectAsset[];
  fonts: ProjectFont[];
}

/** A non-fatal problem noticed while rendering. */
export interface RenderWarning {
  code: string;
  message: string;
  /** Project-relative path the warning relates to, when known. */
  path?: string;
}

/** One entry in the document outline. */
export interface OutlineEntry {
  /** Heading text as it appears in the document. */
  title: string;
  /** Heading level, 1-6. */
  level: number;
  /** Zero-based page index the heading lands on. */
  page: number;
  /** Anchor id assigned to the heading, used for in-document links. */
  anchor: string;
  /** Indices into `OutlineEntry[]` of this entry's children. */
  children: number[];
}

export interface RenderOutline {
  entries: OutlineEntry[];
  pageCount: number;
}

export interface HealthResponse {
  status: 'ok';
  weasyprintVersion: string;
  pythonVersion: string;
}

/** Error shape returned by the service for a failed render. */
export interface RenderError {
  error: string;
  details?: string;
}
