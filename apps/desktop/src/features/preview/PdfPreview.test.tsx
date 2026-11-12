import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import { PdfPreview } from './PdfPreview';

/**
 * The real pdf.js hands the buffer it is given to its worker, and a
 * transferred buffer is detached. That is emulated here, because the bug it
 * causes is invisible otherwise: the preview still draws the page, so
 * everything looks right, but the PDF in the store is left empty and
 * exporting it writes a file of no bytes.
 */
let handedOver: (() => void) | null = null;
const handedOverPromise = new Promise<void>((resolve) => {
  handedOver = resolve;
});

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: ({ data }: { data: Uint8Array }) => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getViewport: () => ({ width: 100, height: 100 }),
        render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
      }),
      destroy: () => {},
    }).then((document) => {
      // What the worker does with a buffer that is transferred to it.
      structuredClone(data.buffer, { transfer: [data.buffer] });
      handedOver?.();
      return document;
    }),
  }),
}));

describe('PdfPreview', () => {
  it('leaves the PDF it was given intact', async () => {
    const pdf = new Uint8Array([1, 2, 3, 4, 5]);

    render(<PdfPreview pdf={pdf} status="ready" error={null} />);

    // The preview has been given the document.
    await handedOverPromise;

    // The buffer the caller keeps is not the one that was handed over, so it
    // is still whole. A transferred buffer has no bytes left in it.
    expect(pdf.length).toBe(5);
    expect(pdf.buffer.byteLength).toBe(5);
  });
});
