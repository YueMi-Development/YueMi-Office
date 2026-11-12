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
    render: (options: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => {
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

      renderTaskRef.current?.cancel();

      const pdfPage = await target.getPage(pageNumber);
      const viewport = pdfPage.getViewport({ scale });
      const pixelRatio = window.devicePixelRatio || 1;

      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const task = pdfPage.render({
        canvasContext: context,
        viewport,
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
    const document = documentRef.current;
    if (!document) {
      return;
    }
    void drawPage(document, page, zoom);
  }, [drawPage, page, zoom, pageCount]);

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
