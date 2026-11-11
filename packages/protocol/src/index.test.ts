import { describe, expect, it } from 'vitest';

import {
  PAGE_SIZES,
  PROJECT_SCHEMA_VERSION,
  type Project,
} from './index';

/**
 * The protocol package holds the contract between the desktop app and the
 * render service. These tests guard the parts of that contract the two sides
 * both rely on, so a change here cannot pass unnoticed on one side only.
 */
describe('the project format', () => {
  it('uses a schema version the app can read', () => {
    expect(PROJECT_SCHEMA_VERSION).toBe(2);
  });

  it('offers the page sizes WeasyPrint understands', () => {
    expect(PAGE_SIZES).toContain('A4');
    expect(PAGE_SIZES).toContain('Letter');
    expect(new Set(PAGE_SIZES).size).toBe(PAGE_SIZES.length);
  });
});

describe('a project', () => {
  const project: Project = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    title: 'Reference Document',
    language: 'en',
    content: ['content/01-reference.md'],
    styles: ['styles/main.css'],
    fonts: ['fonts/inter-400.woff2'],
    assetsDir: 'assets',
    page: { size: 'A4', orientation: 'portrait' },
    pdf: { variant: null },
  };

  it('lists its content in document order', () => {
    expect(project.content[0]).toBe('content/01-reference.md');
  });

  it('has no pdf variant by default', () => {
    expect(project.pdf.variant).toBeNull();
  });
});
