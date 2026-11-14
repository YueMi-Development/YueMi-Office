import { describe, expect, it } from 'vitest';

import {
  PAGE_BREAK,
  insertPage,
  pageHeading,
  pageIndexAt,
  removePage,
  splitPages,
} from './pages';

/**
 * The pages of a file.
 *
 * A page is the part of a file between two page breaks, so what matters here
 * is that a break is found, that a page is taken out with the break that
 * separated it, and that the pages around it close up.
 */

describe('splitPages', () => {
  it('gives an empty file one empty page', () => {
    const pages = splitPages('');

    expect(pages).toHaveLength(1);
    expect(pages[0].start).toBe(0);
    expect(pages[0].end).toBe(0);
  });

  it('gives a file without a break one page', () => {
    const source = '= Title\n\nSome text.';
    const pages = splitPages(source);

    expect(pages).toHaveLength(1);
    expect(pages[0].start).toBe(0);
    expect(pages[0].end).toBe(source.length);
  });

  it('gives a file with one break two pages', () => {
    const first = '= One\n\n';
    const pages = splitPages(`${first}${PAGE_BREAK}\n\n= Two\n`);

    expect(pages).toHaveLength(2);
    expect(pages[0].end).toBe(first.length);
    expect(pages[1].start).toBe(first.length + PAGE_BREAK.length);
  });

  it('gives a file with several breaks a page for each part', () => {
    const pages = splitPages(`a${PAGE_BREAK}b${PAGE_BREAK}c`);

    expect(pages).toHaveLength(3);
    expect(pages.map((page) => page.index)).toEqual([0, 1, 2]);
  });

  it('counts a break at the start of a file', () => {
    const pages = splitPages(`${PAGE_BREAK}\n\n= Second`);

    expect(pages).toHaveLength(2);
    expect(pages[0].end).toBe(0);
  });

  it('counts a break at the end of a file', () => {
    const pages = splitPages(`= Only\n\n${PAGE_BREAK}`);

    expect(pages).toHaveLength(2);
    expect(pages[1].end).toBe(pages[1].start);
  });

  it('leaves a weak break alone, because it does not start a page', () => {
    const pages = splitPages('a\n\n#pagebreak(weak: true)\n\nb');

    expect(pages).toHaveLength(1);
  });
});

describe('pageIndexAt', () => {
  const text = `= One\n\n${PAGE_BREAK}\n\n= Two\n\n${PAGE_BREAK}\n\n= Three\n`;
  const pages = splitPages(text);

  it('finds the first page', () => {
    expect(pageIndexAt(pages, 0)).toBe(0);
    expect(pageIndexAt(pages, 4)).toBe(0);
  });

  it('finds a later page', () => {
    expect(pageIndexAt(pages, pages[1].start + 1)).toBe(1);
    expect(pageIndexAt(pages, pages[2].start + 1)).toBe(2);
  });

  it('puts an offset past the end on the last page', () => {
    expect(pageIndexAt(pages, text.length + 100)).toBe(2);
  });
});

describe('insertPage', () => {
  it('puts a break in the middle of the text', () => {
    const result = insertPage('Hello world', 5).text;

    expect(result).toBe(`Hello\n\n${PAGE_BREAK}\nworld`);
    expect(splitPages(result)).toHaveLength(2);
  });

  it('puts a break at the start of the text', () => {
    const result = insertPage('Hello', 0).text;

    expect(result).toBe(`${PAGE_BREAK}\nHello`);
    expect(splitPages(result)).toHaveLength(2);
  });

  it('puts a break at the end of the text', () => {
    const result = insertPage('Hello', 5).text;

    expect(result).toBe(`Hello\n\n${PAGE_BREAK}`);
    expect(splitPages(result)).toHaveLength(2);
  });

  it('gives the file one more page than it had', () => {
    const text = `= One\n\n${PAGE_BREAK}\n\n= Two\n`;
    const before = splitPages(text).length;
    const after = splitPages(insertPage(text, 4).text).length;

    expect(after).toBe(before + 1);
  });

  it('leaves the text around the break alone', () => {
    const result = insertPage('Hello world', 5).text;

    expect(result).toContain('Hello');
    expect(result).toContain('world');
  });

  it('says where the new page starts', () => {
    const insertion = insertPage('Hello world', 5);
    const pages = splitPages(insertion.text);

    expect(pages).toHaveLength(2);
    expect(insertion.offset).toBe(pages[1].start);
  });
});

describe('removePage', () => {
  const text = `= One\n\n${PAGE_BREAK}\n\n= Two\n\n${PAGE_BREAK}\n\n= Three\n`;

  it('leaves a file with a single page alone', () => {
    expect(removePage('= Only\n', 0)).toBe('= Only\n');
  });

  it('takes the first page out with the break behind it', () => {
    const result = removePage(text, 0);

    expect(result).not.toContain('= One');
    expect(result).toContain('= Two');
    expect(result).toContain('= Three');
    expect(splitPages(result)).toHaveLength(2);
  });

  it('takes a page in the middle out with the break behind it', () => {
    const result = removePage(text, 1);

    expect(result).not.toContain('= Two');
    expect(result).toContain('= One');
    expect(result).toContain('= Three');
    expect(splitPages(result)).toHaveLength(2);
  });

  it('takes the last page out with the break in front of it', () => {
    const result = removePage(text, 2);

    expect(result).not.toContain('= Three');
    expect(result).toContain('= One');
    expect(result).toContain('= Two');
    expect(splitPages(result)).toHaveLength(2);
  });

  it('closes the seam with one blank line', () => {
    const result = removePage(text, 1);

    expect(result).not.toMatch(/\n{3,}/);
  });

  it('ignores a page that is not there', () => {
    expect(removePage(text, 9)).toBe(text);
    expect(removePage(text, -1)).toBe(text);
  });
});

describe('pageHeading', () => {
  it('finds the heading a page starts with', () => {
    const text = `= One\n\ntext\n\n${PAGE_BREAK}\n\n= Two\n`;
    const pages = splitPages(text);

    expect(pageHeading(text, pages[0])).toBe('One');
    expect(pageHeading(text, pages[1])).toBe('Two');
  });

  it('gives nothing for a page without a heading', () => {
    const text = 'Just some text.';
    const pages = splitPages(text);

    expect(pageHeading(text, pages[0])).toBeNull();
  });
});
