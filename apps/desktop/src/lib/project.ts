import {
  PROJECT_SCHEMA_VERSION,
  type Orientation,
  type PageSize,
  type Project,
} from '@yuemi/protocol';

export { PROJECT_SCHEMA_VERSION };

/**
 * Builds a project with sensible defaults for a new document.
 */
export function createEmptyProject(title = 'Untitled'): Project {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    title,
    language: 'en',
    content: [],
    styles: ['styles/main.css'],
    assetsDir: 'assets',
    page: { size: 'A4', orientation: 'portrait' },
    pdf: { variant: null },
  };
}

export interface ProjectValidationIssue {
  path: string;
  message: string;
}

/**
 * Checks that a parsed `project.json` describes a usable project.
 *
 * The issues are returned rather than thrown so the app can show all of them
 * at once and let the user fix them.
 */
export function validateProject(value: unknown): ProjectValidationIssue[] {
  const issues: ProjectValidationIssue[] = [];

  if (typeof value !== 'object' || value === null) {
    return [{ path: '', message: 'Project file must contain a JSON object.' }];
  }

  const project = value as Partial<Project>;

  if (typeof project.schemaVersion !== 'number') {
    issues.push({ path: 'schemaVersion', message: 'Must be a number.' });
  } else if (project.schemaVersion > PROJECT_SCHEMA_VERSION) {
    issues.push({
      path: 'schemaVersion',
      message: `Project uses version ${project.schemaVersion}, but this app supports up to ${PROJECT_SCHEMA_VERSION}.`,
    });
  }

  if (typeof project.title !== 'string' || project.title.length === 0) {
    issues.push({ path: 'title', message: 'Must be a non-empty string.' });
  }

  if (typeof project.language !== 'string' || project.language.length === 0) {
    issues.push({ path: 'language', message: 'Must be a non-empty string.' });
  }

  if (!Array.isArray(project.content)) {
    issues.push({ path: 'content', message: 'Must be an array of file paths.' });
  } else {
    project.content.forEach((entry, index) => {
      if (typeof entry !== 'string' || entry.length === 0) {
        issues.push({ path: `content[${index}]`, message: 'Must be a file path.' });
      }
    });
  }

  if (!Array.isArray(project.styles)) {
    issues.push({ path: 'styles', message: 'Must be an array of file paths.' });
  } else {
    project.styles.forEach((entry, index) => {
      if (typeof entry !== 'string' || entry.length === 0) {
        issues.push({ path: `styles[${index}]`, message: 'Must be a file path.' });
      }
    });
  }

  if (typeof project.assetsDir !== 'string') {
    issues.push({ path: 'assetsDir', message: 'Must be a directory path.' });
  }

  if (typeof project.page !== 'object' || project.page === null) {
    issues.push({ path: 'page', message: 'Must define the page size.' });
  } else {
    if (!isPageSize(project.page.size)) {
      issues.push({ path: 'page.size', message: `Unknown page size.` });
    }
    if (!isOrientation(project.page.orientation)) {
      issues.push({ path: 'page.orientation', message: 'Must be portrait or landscape.' });
    }
  }

  if (typeof project.pdf !== 'object' || project.pdf === null) {
    issues.push({ path: 'pdf', message: 'Must define the PDF options.' });
  }

  return issues;
}

function isPageSize(value: unknown): value is PageSize {
  return (
    typeof value === 'string' &&
    ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'Letter', 'Legal', 'Tabloid'].includes(value)
  );
}

function isOrientation(value: unknown): value is Orientation {
  return value === 'portrait' || value === 'landscape';
}

/**
 * Parses a `project.json` file, filling in defaults for anything missing.
 *
 * A missing file is not an error: a folder with only Markdown and CSS is a
 * valid project.
 */
export function parseProject(text: string): {
  project: Project;
  issues: ProjectValidationIssue[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      project: createEmptyProject(),
      issues: [
        {
          path: '',
          message: `Project file is not valid JSON: ${(error as Error).message}`,
        },
      ],
    };
  }

  const issues = validateProject(parsed);

  if (issues.length > 0) {
    const fallback = createEmptyProject();
    const partial = parsed as Partial<Project>;
    return {
      project: {
        ...fallback,
        ...partial,
        page: { ...fallback.page, ...(partial.page ?? {}) },
        pdf: { ...fallback.pdf, ...(partial.pdf ?? {}) },
      },
      issues,
    };
  }

  return { project: parsed as Project, issues: [] };
}

/**
 * Serializes a project for writing to `project.json`.
 */
export function serializeProject(project: Project): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

/**
 * Normalises a path to the forward-slash form used inside project files.
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Returns the file name of a project-relative path.
 */
export function basename(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? normalized : normalized.slice(index + 1);
}

/**
 * Returns the directory of a project-relative path, or an empty string.
 */
export function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
}
