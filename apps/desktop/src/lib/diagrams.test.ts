import { describe, expect, it } from 'vitest';

import architecture from '../../../../docs/architecture.md?raw';
import assistant from '../../../../docs/assistant.md?raw';
import development from '../../../../docs/development.md?raw';

/**
 * The diagrams in the documentation.
 *
 * A mermaid diagram that does not parse shows up on the page as a block of
 * text, and nobody notices until they go looking for the picture. The
 * diagrams are parsed here, with mermaid itself, so a broken one fails the
 * suite rather than the page.
 */

const DOCUMENTS: { name: string; text: string }[] = [
  { name: 'architecture.md', text: architecture },
  { name: 'assistant.md', text: assistant },
  { name: 'development.md', text: development },
];

/**
 * The mermaid blocks of a document.
 */
function blocksOf(text: string): string[] {
  return [...text.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((match) => match[1]);
}

describe('the diagrams in the documentation', () => {
  it('are there to be checked', () => {
    const count = DOCUMENTS.reduce((total, doc) => total + blocksOf(doc.text).length, 0);

    expect(count).toBeGreaterThan(0);
  });

  for (const document of DOCUMENTS) {
    it(`every diagram in ${document.name} parses`, async () => {
      const { default: mermaid } = await import('mermaid');
      mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });

      for (const block of blocksOf(document.text)) {
        await expect(mermaid.parse(block)).resolves.toBeDefined();
      }
    });
  }
});
