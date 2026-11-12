import { useCallback, useEffect, useRef, useState } from 'react';

export interface PdfPreviewProps {
  pdf: Uint8Array | null;
  status: 'idle' | 'rendering' | 'ready' | 'error';
  error: string | null;
}

interface PdfDocument {
  numPages: number;
  getPage: (pageNumber: number) => Promise<{
    getViewport: (options: { scale: number }) => { width: number; height: number };
    render: (options: {
      canvasContext: CanvasRenderingContext2D;
      viewport: unknown;
      transform?: number[];
    }) => {
      promise: Promise<void>;
      cancel: () => void;
    };
  }>;
  destroy: () => void;
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function loadPdfJs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then(async (module) => {
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url'))
        .default;
      module.GlobalWorkerOptions.workerSrc = workerUrl;
      return module;
    });
  }
  return pdfjsPromise;
}

export function PdfPreview({ pdf, status, error }: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const documentRef = useRef<PdfDocument | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  /**
   * The number of the draw that is running.
   *
   * pdf.js refuses to draw twice on the same canvas at once, so a draw that
   * has been superseded stops as soon as it notices that it is not the
   * current one.
   */
  const drawIdRef = useRef(0);
  /**
   * The document that is on screen.
   *
   * It is state rather than only a ref, because the page has to be painted
   * again whenever a new PDF arrives. A ref would not tell React that
   * anything changed, and the page count is often the same from one
   * document to the next, so the pane would keep showing the old document.
   */
  const [loadedDocument, setLoadedDocument] = useState<PdfDocument | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);

  const drawPage = useCallback(
    async (target: PdfDocument, pageNumber: number, scale: number) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const context = canvas.getContext('2d');
      if (!context) {
        return;
      }

      // Every draw takes a number, so that a draw which has been superseded
      // can tell that it is no longer the one on screen.
      const drawId = ++drawIdRef.current;

      renderTaskRef.current?.cancel();

      const pdfPage = await target.getPage(pageNumber);

      // A newer draw has been started in the meantime, so this one has
      // nothing to do. It stops before it touches the canvas, because
      // clearing the canvas now would erase the newer draw's page.
      if (drawId !== drawIdRef.current) {
        return;
      }

      const viewport = pdfPage.getViewport({ scale });
      const pixelRatio = window.devicePixelRatio || 1;

      // The canvas is given a backing store of the size of the screen's
      // pixels, and the page is drawn into it at that resolution. Without
      // the transform the page would only fill the top left corner of the
      // backing store, and the browser would scale the whole bitmap down,
      // so the document would appear at a fraction of its real size.
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const task = pdfPage.render({
        canvasContext: context,
        viewport,
        transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });
      renderTaskRef.current = task;

      try {
        await task.promise;
      } catch (renderError) {
        // A cancelled render is expected when the page or zoom changes.
        if ((renderError as { name?: string }).name !== 'RenderingCancelledException') {
          setLoadError((renderError as Error).message);
        }
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!pdf) {
        documentRef.current?.destroy();
        documentRef.current = null;
        setLoadedDocument(null);
        setPageCount(0);
        setPage(1);
        return;
      }

      try {
        const pdfjs = await loadPdfJs();
        // pdf.js hands the buffer to its worker, which detaches it, so it is
        // given a copy. Without this the PDF in the store would be left as an
        // empty buffer and exporting it would write a file of no bytes.
        const task = pdfjs.getDocument({ data: pdf.slice() });
        const loaded = (await task.promise) as unknown as PdfDocument;
        if (cancelled) {
          loaded.destroy();
          return;
        }
        documentRef.current?.destroy();
        documentRef.current = loaded;
        setLoadedDocument(loaded);
        setPageCount(loaded.numPages);
        setPage((current) => Math.min(current, loaded.numPages) || 1);
        setLoadError(null);
      } catch (loadFailure) {
        if (!cancelled) {
          setLoadError((loadFailure as Error).message);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [pdf]);

  useEffect(() => {
    if (!loadedDocument || page > loadedDocument.numPages) {
      return;
    }
    void drawPage(loadedDocument, page, zoom);
  }, [loadedDocument, drawPage, page, zoom]);

  useEffect(() => {
    return () => {
      renderTaskRef.current?.cancel();
      documentRef.current?.destroy();
      documentRef.current = null;
    };
  }, []);

  const canGoPrevious = page > 1;
  const canGoNext = page < pageCount;

  return (
    <div className="preview">
      <div className="preview-toolbar">
        <div className="preview-nav">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={!canGoPrevious}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span className="preview-page-indicator">
            {pageCount > 0 ? `${page} / ${pageCount}` : '—'}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            disabled={!canGoNext}
            aria-label="Next page"
          >
            ›
          </button>
        </div>

        <div className="preview-zoom">
          <button
            type="button"
            onClick={() => setZoom((current) => Math.max(0.25, current - 0.25))}
            aria-label="Zoom out"
          >
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoom((current) => Math.min(4, current + 0.25))}
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>

      <div className="preview-canvas-area">
        {status === 'rendering' && (
          <div className="preview-status">Rendering…</div>
        )}
        {status === 'error' && (
          <div className="preview-status preview-error">{error}</div>
        )}
        {loadError && <div className="preview-status preview-error">{loadError}</div>}
        <canvas ref={canvasRef} className="preview-canvas" />
      </div>
    </div>
  );
}
