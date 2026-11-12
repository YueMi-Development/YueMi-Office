import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

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

/**
 * The pages that were painted, with the options they were painted with.
 */
interface PaintedPage {
  documentId: number;
  options: {
    canvasContext: unknown;
    viewport: unknown;
    transform?: number[];
  };
}

const paintedPages: PaintedPage[] = [];
let nextDocumentId = 0;

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: ({ data }: { data: Uint8Array }) => {
    const id = ++nextDocumentId;
    const document = {
      id,
      numPages: 1,
      getPage: async () => ({
        getViewport: () => ({ width: 100, height: 100 }),
        render: (options: PaintedPage['options']) => {
          paintedPages.push({ documentId: id, options });
          return { promise: Promise.resolve(), cancel: () => {} };
        },
      }),
      destroy: () => {},
    };

    return {
      promise: Promise.resolve(document).then((loaded) => {
        // What the worker does with a buffer that is transferred to it.
        structuredClone(data.buffer, { transfer: [data.buffer] });
        handedOver?.();
        return loaded;
      }),
    };
  },
}));

/**
 * jsdom has no canvas implementation, so the context is stubbed.
 *
 * The preview only hands the context to pdf.js, which is stubbed too, so a
 * context that records nothing is enough.
 */
function stubCanvasContext(): void {
  HTMLCanvasElement.prototype.getContext = vi.fn(
    function getContext(this: HTMLCanvasElement) {
      return { canvas: this } as unknown as CanvasRenderingContext2D;
    },
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

describe('PdfPreview', () => {
  beforeEach(() => {
    paintedPages.length = 0;
    stubCanvasContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('paints a new document even when the page count is unchanged', async () => {
    const { rerender } = render(
      <PdfPreview pdf={new Uint8Array([1])} status="ready" error={null} />,
    );

    await waitFor(() => {
      expect(paintedPages.length).toBeGreaterThan(0);
    });

    const firstDocumentId = paintedPages[paintedPages.length - 1]?.documentId;

    // The second document has the same number of pages as the first, which
    // is what makes it easy to miss: the preview has to paint it anyway, or
    // the pane keeps showing the document that was there before.
    rerender(<PdfPreview pdf={new Uint8Array([2])} status="ready" error={null} />);

    await waitFor(() => {
      const painted = paintedPages[paintedPages.length - 1];
      expect(painted?.documentId).not.toBe(firstDocumentId);
    });
  });

  it('paints the page at the resolution of the screen', async () => {
    const original = Object.getOwnPropertyDescriptor(
      window,
      'devicePixelRatio',
    );

    Object.defineProperty(window, 'devicePixelRatio', {
      value: 2,
      configurable: true,
    });

    try {
      render(<PdfPreview pdf={new Uint8Array([1])} status="ready" error={null} />);

      await waitFor(() => {
        expect(paintedPages.length).toBeGreaterThan(0);
      });

      // The page is drawn at twice the size so that it fills a backing
      // store that is twice as large, instead of occupying a quarter of it.
      const painted = paintedPages[paintedPages.length - 1];
      expect(painted?.options.transform).toEqual([2, 0, 0, 2, 0, 0]);

      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas.preview-canvas',
      );
      expect(canvas?.width).toBe(200);
      expect(canvas?.height).toBe(200);
      expect(canvas?.style.width).toBe('100px');
    } finally {
      if (original) {
        Object.defineProperty(window, 'devicePixelRatio', original);
      }
    }
  });
});
