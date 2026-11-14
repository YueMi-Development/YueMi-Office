/**
 * The pages of a Typst file.
 *
 * Typst decides where a page breaks, so a page cannot be moved around in the
 * editor: the text of a paragraph may run over a page boundary or fit on one.
 * The one boundary a writer controls is an explicit page break, so a page here
 * is the part of a file that sits between two page breaks.
 *
 * The functions are pure. They take text and give text back, so the behaviour
 * can be tested without an editor, a store or a renderer.
 */

/** The page break that separates two pages. */
export const PAGE_BREAK = '#pagebreak()';

/**
 * The page breaks of a file.
 *
 * Only a plain page break is a boundary. A weak break does not start a new
 * page, so it is left alone. The break is captured rather than only matched,
 * because the offsets of the pages have to account for the space a break
 * takes up.
 */
const BREAK_PATTERN = /(#pagebreak\(\s*\))/g;

/**
 * Where one page's own text sits in a file.
 *
 * The offsets do not cover the page breaks around the page.
 */
export interface PageSpan {
  /** The page's position in the file, starting at zero. */
  index: number;
  /** The offset the page's text starts at. */
  start: number;
  /** The offset the page's text ends at. */
  end: number;
}

/**
 * Splits a text into the parts it is made of.
 *
 * The parts alternate between the text of a page and the break that follows
 * it, so the parts of a file with two breaks are the text of the first page,
 * the break, the text of the second page, the break, and the text of the
 * third page.
 */
function splitParts(text: string): string[] {
  return text.split(BREAK_PATTERN);
}

/**
 * The pages of a text, in order.
 *
 * An empty text is one empty page, so there is always at least one page.
 */
export function splitPages(text: string): PageSpan[] {
  const spans: PageSpan[] = [];
  const parts = splitParts(text);

  let offset = 0;

  for (let index = 0; index < parts.length; index += 2) {
    const end = offset + parts[index].length;
    spans.push({ index: spans.length, start: offset, end });

    // The break sits between this page and the next one.
    if (index + 1 < parts.length) {
      offset = end + parts[index + 1].length;
    }
  }

  return spans;
}

/**
 * The page an offset falls in.
 *
 * An offset past the end of the text belongs to the last page, and an offset
 * inside a page break belongs to the page the break came from.
 */
export function pageIndexAt(spans: PageSpan[], offset: number): number {
  let found = 0;

  for (const span of spans) {
    if (span.start > offset) {
      break;
    }
    found = span.index;
  }

  return found;
}

/**
 * A page that was put into a text.
 */
export interface PageInsertion {
  /** The text with the page in it. */
  text: string;
  /** The offset the new page starts at. */
  offset: number;
}

/**
 * Puts a page into a text at an offset.
 *
 * The break goes on a line of its own, with a blank line in front of it, so
 * that it stands on its own rather than sitting in the middle of a
 * paragraph. The text after the offset starts the new page.
 *
 * The offset the new page starts at is given back, so that the cursor can be
 * put on the page that was just made.
 */
export function insertPage(text: string, offset: number): PageInsertion {
  const at = Math.max(0, Math.min(offset, text.length));

  const left = text.slice(0, at).replace(/\s+$/, '');
  const right = text.slice(at).replace(/^\s+/, '');

  if (left === '') {
    return {
      text: right === '' ? PAGE_BREAK : `${PAGE_BREAK}\n${right}`,
      offset: PAGE_BREAK.length,
    };
  }

  if (right === '') {
    return {
      text: `${left}\n\n${PAGE_BREAK}`,
      offset: left.length + 2 + PAGE_BREAK.length,
    };
  }

  return {
    text: `${left}\n\n${PAGE_BREAK}\n${right}`,
    offset: left.length + 2 + PAGE_BREAK.length,
  };
}

/**
 * Joins the text on either side of a removal.
 *
 * The seam between the two is one blank line, so the pages close up without
 * the file filling up with the blank lines the break left behind.
 */
function joinSeam(left: string, right: string): string {
  const before = left.replace(/\s+$/, '');
  const after = right.replace(/^\s+/, '');

  if (before === '') {
    return after;
  }

  if (after === '') {
    return before;
  }

  return `${before}\n\n${after}`;
}

/**
 * Takes a page out of a text.
 *
 * The page goes with the break that separated it from the page after it, or
 * with the break that came before it when it is the last page. A file with a
 * single page is left alone, because there is nothing to close up.
 */
export function removePage(text: string, index: number): string {
  const parts = splitParts(text);
  const pageCount = Math.ceil(parts.length / 2);

  if (index < 0 || index >= pageCount || pageCount < 2) {
    return text;
  }

  const isLast = index === pageCount - 1;

  // The last page takes the break in front of it with it, because there is
  // no page after it for the break to separate. Every other page leaves the
  // break in front of it and goes with the break behind it.
  const left = parts.slice(0, isLast ? 2 * index - 1 : 2 * index).join('');
  const right = parts.slice(isLast ? 2 * index + 1 : 2 * index + 2).join('');

  return joinSeam(left, right);
}

/**
 * The heading a page starts with, when it has one.
 *
 * The heading is what a reader would call the page, so it is what a
 * confirmation names.
 */
export function pageHeading(text: string, span: PageSpan): string | null {
  const body = text.slice(span.start, span.end);
  const match = /^\s*=\s+(.+)$/m.exec(body);

  return match ? match[1].trim() : null;
}
