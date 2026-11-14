import { StreamLanguage, type StreamParser } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/**
 * Syntax support for Typst.
 *
 * There is no CodeMirror package for Typst, so the mode is written here.
 * It is a stream parser rather than a full grammar, because what the editor
 * needs is to know what a heading, a comment and a raw block look like —
 * enough to colour the document as it is written.
 */

/**
 * What the parser remembers between lines.
 */
interface TypstState {
  /** Whether the parser is inside a raw block. */
  inRaw: boolean;
}

/**
 * The keywords Typst knows, which are the ones a reader recognises.
 */
const KEYWORDS = new Set([
  'let',
  'set',
  'show',
  'import',
  'include',
  'if',
  'else',
  'for',
  'while',
  'break',
  'continue',
  'return',
  'in',
  'not',
  'and',
  'or',
  'as',
]);

/**
 * The names the parser hands back, and the tags they are coloured by.
 *
 * A stream parser returns a name rather than a tag, and the table below is
 * what turns that name into a colour.
 */
const TOKEN_TABLE = {
  heading: t.heading,
  comment: t.comment,
  string: t.string,
  keyword: t.keyword,
  code: t.processingInstruction,
  raw: t.monospace,
} as const;

/**
 * The stream parser.
 *
 * A line that starts with `=` is a heading, and its depth is how many `=`
 * marks it has. A line that starts with `//` is a comment. A line that
 * starts with three backticks is a raw block, which runs until the next
 * three backticks.
 */
const parser: StreamParser<TypstState> = {
  name: 'typst',

  tokenTable: TOKEN_TABLE,

  startState(): TypstState {
    return { inRaw: false };
  },

  token(stream, state): string | null {
    if (state.inRaw) {
      if (stream.match('```')) {
        state.inRaw = false;
      }
      stream.skipToEnd();
      return 'raw';
    }

    if (stream.sol()) {
      if (stream.match('```')) {
        state.inRaw = true;
        stream.skipToEnd();
        return 'raw';
      }
      if (stream.match('//')) {
        stream.skipToEnd();
        return 'comment';
      }
      if (stream.match(/^=+/)) {
        stream.skipToEnd();
        return 'heading';
      }
    }

    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }

    if (stream.match('"')) {
      stream.skipToEnd();
      return 'string';
    }

    const word = stream.match(/[a-zA-Z_][a-zA-Z0-9_-]*/);
    if (typeof word === 'object' && word !== null && KEYWORDS.has(word[0])) {
      return 'keyword';
    }

    if (stream.match(/[#$*_@<>[\]]/)) {
      return 'code';
    }

    stream.next();
    return null;
  },

  languageData: {
    commentTokens: { line: '//' },
  },
};

/**
 * The Typst mode, ready to be used as an editor extension.
 */
export const typstLanguage = StreamLanguage.define(parser);
