import { describe, expect, it } from 'vitest';

import {
  basename,
  createEmptyProject,
  dirname,
  normalizePath,
  parseProject,
  PROJECT_SCHEMA_VERSION,
  serializeProject,
  upgradeProject,
  validateProject,
} from '../lib/project';

describe('createEmptyProject', () => {
  it('produces a usable project', () => {
    const project = createEmptyProject('My Report');

    expect(project.title).toBe('My Report');
    expect(project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(project.page.size).toBe('A4');
    expect(project.page.orientation).toBe('portrait');
    expect(project.content).toEqual([]);
    expect(project.pdf.variant).toBeNull();
  });
});

describe('validateProject', () => {
  it('accepts a well-formed project', () => {
    expect(validateProject(createEmptyProject())).toEqual([]);
  });

  it('rejects a non-object', () => {
    expect(validateProject('nope')).toHaveLength(1);
    expect(validateProject(null)).toHaveLength(1);
  });

  it('reports a missing title', () => {
    const issues = validateProject({ ...createEmptyProject(), title: '' });

    expect(issues.some((issue) => issue.path === 'title')).toBe(true);
  });

  it('reports an unknown page size', () => {
    const issues = validateProject({
      ...createEmptyProject(),
      page: { size: 'A99', orientation: 'portrait' },
    });

    expect(issues.some((issue) => issue.path === 'page.size')).toBe(true);
  });

  it('reports a bad orientation', () => {
    const issues = validateProject({
      ...createEmptyProject(),
      page: { size: 'A4', orientation: 'sideways' },
    });

    expect(issues.some((issue) => issue.path === 'page.orientation')).toBe(true);
  });

  it('reports a schema version from the future', () => {
    const issues = validateProject({ ...createEmptyProject(), schemaVersion: 99 });

    expect(issues.some((issue) => issue.path === 'schemaVersion')).toBe(true);
  });

  it('reports non-string entries in the content list', () => {
    const issues = validateProject({
      ...createEmptyProject(),
      content: ['ok.md', 42],
    });

    expect(issues.some((issue) => issue.path === 'content[1]')).toBe(true);
  });

  it('reports a fonts list that is not an array of paths', () => {
    const issues = validateProject({
      ...createEmptyProject(),
      fonts: ['fonts/ok.woff2', 7],
    });

    expect(issues.some((issue) => issue.path === 'fonts[1]')).toBe(true);
  });

  it('accepts a project without a fonts list', () => {
    const { fonts, ...withoutFonts } = createEmptyProject();

    expect(validateProject(withoutFonts)).toEqual([]);
  });
});

describe('upgradeProject', () => {
  it('gives a version 1 project an empty fonts list', () => {
    const project = { ...createEmptyProject(), schemaVersion: 1 } as Partial<
      ReturnType<typeof createEmptyProject>
    >;
    delete project.fonts;

    const upgraded = upgradeProject(project as ReturnType<typeof createEmptyProject>);

    expect(upgraded.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(upgraded.fonts).toEqual([]);
  });

  it('keeps the fonts a project already has', () => {
    const project = {
      ...createEmptyProject(),
      fonts: ['fonts/inter-400.woff2'],
    };

    expect(upgradeProject(project).fonts).toEqual(['fonts/inter-400.woff2']);
  });
});

describe('parseProject', () => {
  it('round-trips a serialized project', () => {
    const project = createEmptyProject('Round Trip');
    project.content = ['content/a.md'];

    const { project: parsed, issues } = parseProject(serializeProject(project));

    expect(issues).toEqual([]);
    expect(parsed.title).toBe('Round Trip');
    expect(parsed.content).toEqual(['content/a.md']);
  });

  it('reports invalid JSON instead of throwing', () => {
    const { issues } = parseProject('{ not json');

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/not valid JSON/);
  });

  it('fills in defaults when fields are missing', () => {
    const { project, issues } = parseProject('{"title": "Partial"}');

    expect(issues.length).toBeGreaterThan(0);
    expect(project.title).toBe('Partial');
    expect(project.page.size).toBe('A4');
  });

  it('keeps the page size when other fields are missing', () => {
    const { project } = parseProject(
      '{"title": "Partial", "page": {"size": "Letter", "orientation": "landscape"}}',
    );

    expect(project.page.size).toBe('Letter');
    expect(project.page.orientation).toBe('landscape');
  });

  it('upgrades a version 1 project by giving it a fonts list', () => {
    const { project, issues } = parseProject(
      JSON.stringify({
        schemaVersion: 1,
        title: 'Old Project',
        language: 'en',
        content: ['content/a.md'],
        styles: ['styles/main.css'],
        assetsDir: 'assets',
        page: { size: 'A4', orientation: 'portrait' },
        pdf: { variant: null },
      }),
    );

    expect(issues).toEqual([]);
    expect(project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(project.fonts).toEqual([]);
  });

  it('keeps the fonts of a version 2 project', () => {
    const project = createEmptyProject('With Fonts');
    project.fonts = ['fonts/inter-400.woff2'];

    const { project: parsed } = parseProject(serializeProject(project));

    expect(parsed.fonts).toEqual(['fonts/inter-400.woff2']);
  });
});

describe('path helpers', () => {
  it('normalises backslashes to forward slashes', () => {
    expect(normalizePath('content\\intro.md')).toBe('content/intro.md');
  });

  it('strips a leading ./', () => {
    expect(normalizePath('./content/intro.md')).toBe('content/intro.md');
  });

  it('returns the file name', () => {
    expect(basename('content/intro.md')).toBe('intro.md');
    expect(basename('intro.md')).toBe('intro.md');
  });

  it('returns the directory', () => {
    expect(dirname('content/intro.md')).toBe('content');
    expect(dirname('intro.md')).toBe('');
  });
});
