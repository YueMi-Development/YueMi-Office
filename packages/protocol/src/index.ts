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

/**
 * The port the render service listens on.
 *
 * It is here rather than in the app's own code because the service, the
 * image that runs it and the app that calls it all have to agree on it.
 *
 * The port is chosen to be out of the way. 8000 is the first port every
 * Python web framework is taught to use, so it is the first port anything
 * else on a developer's machine takes, and a service that cannot start
 * because something else is already listening is a bad first impression.
 *
 * The port sits in the 32000 band, which is above the ports that software
 * actually listens on by default and below the range the operating system
 * hands out to short-lived connections. The upper end of the band is the
 * important part: Windows and macOS hand out ephemeral ports from 49152
 * and Linux from 32768, so a service listening there is never handed a
 * port that is already in use, and the service never has one taken away
 * from under it.
 *
 * The port is also unregistered and unused by the tools a document studio
 * is developed alongside. That is worth checking rather than assuming:
 * 8123 looks equally free in the IANA registry, but it is the default
 * port of Home Assistant, which is a de facto standard the registry does
 * not know about.
 */
export const SERVICE_PORT = 32100;

export {
  applyChanges,
  applyEdit,
  changesOfHunks,
  describeEdit,
  splitLines,
} from './diff';

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

/**
 * The tools the AI assistant can use.
 *
 * The assistant never writes a file itself: every change goes through
 * `propose_edit` and is shown to the user for approval (PRD section 7).
 */
export const AI_TOOL_NAMES = [
  'list_sections',
  'read_section',
  'search',
  'propose_edit',
  'set_style',
  'render_preview',
] as const;

export type AiToolName = (typeof AI_TOOL_NAMES)[number];

/** A tool the assistant can call, with the schema of its arguments. */
export interface AiToolDescription {
  name: AiToolName;
  description: string;
  /** JSON schema describing the tool's arguments. */
  parameters: Record<string, unknown>;
}

/** One tool call, as the assistant asks for it. */
export interface AiToolCall {
  /** Identifier used to match the result to the call. */
  id?: string;
  name: AiToolName;
  arguments?: Record<string, unknown>;
}

/** What a tool call produced. */
export interface AiToolResult {
  id: string;
  name: AiToolName;
  arguments: Record<string, unknown>;
  ok: boolean;
  /** The tool's answer, when it succeeded. */
  result?: Record<string, unknown>;
  /** Why the call failed, when it did. */
  error?: string;
}

/** The kind of line a diff line represents. */
export type DiffLineKind = 'context' | 'added' | 'removed';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** Line number in the file before the change, counting from 1. */
  oldLine?: number;
  /** Line number in the file after the change, counting from 1. */
  newLine?: number;
}

/**
 * One replacement inside a file.
 *
 * The lines it removes are counted from the start of the file, so a change
 * can be applied on its own. This is what makes accepting a single hunk
 * possible.
 */
export interface DiffChange {
  /** First line the change touches, counting from 1. */
  oldStart: number;
  /** How many lines the change removes. */
  oldCount: number;
  /** The lines the change puts in their place. */
  newLines: string[];
}

/**
 * A run of changes shown together, with the lines around them for context.
 */
export interface DiffHunk {
  /** First line of the hunk in the file before the change, counting from 1. */
  oldStart: number;
  /** How many lines of the original file the hunk covers. */
  oldCount: number;
  /** First line of the hunk in the file after the change, counting from 1. */
  newStart: number;
  /** How many lines of the changed file the hunk covers. */
  newCount: number;
  lines: DiffLine[];
  /** The changes the hunk holds, which are what accepting it applies. */
  changes: DiffChange[];
}

/**
 * A change the assistant proposes to make to one file.
 */
export interface ProposedEdit {
  id: string;
  /** Project-relative path of the file being changed. */
  path: string;
  kind: 'replace' | 'create';
  /** The file's contents before the change. */
  oldText: string;
  /** The file's contents after the change. */
  newText: string;
  hunks: DiffHunk[];
}

/** The request the desktop app sends to run a session of tool calls. */
export interface AiSessionRequest {
  project: Project;
  files: ProjectFile[];
  assets: ProjectAsset[];
  fonts: ProjectFont[];
  calls: AiToolCall[];
}

/** The result of a session: what each call did, and what it proposed. */
export interface AiSession {
  id: string;
  calls: AiToolResult[];
  edits: ProposedEdit[];
}
