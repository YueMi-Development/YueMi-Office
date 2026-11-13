"""Turning the rendered PDF into page images.

The assistant looks at the pages after a change that affects the layout, so
it can see what it did rather than only being told. The images are produced
here, on the machine that runs the service, and travel to the app as PNG
bytes encoded in base64.

The PDF is rasterised with PDFium, which is the same engine Chromium uses.
It is a separate dependency from the renderer on purpose: the renderer
decides the bytes of the PDF, and adding a rasteriser to it would mean a
version bump could change those bytes too.
"""

from __future__ import annotations

import base64
import io

import pypdfium2 as pdfium

#: How much bigger than the page the image is.
#:
#: A scale of 1.5 gives a readable image without sending more pixels than the
#: model needs to judge a layout.
SCALE = 1.5

#: The most pages that are rasterised.
#:
#: A long document would otherwise produce a very large response, and the
#: assistant is shown the first few pages anyway.
MAX_PAGES = 8


def rasterize(
    pdf_bytes: bytes, scale: float = SCALE, max_pages: int = MAX_PAGES
) -> tuple[int, list[bytes]]:
    """Turn the pages of a PDF into PNG images.

    Returns the number of pages the document has and the images of the first
    few of them. A page that cannot be drawn does not stop the others: the
    list simply ends there, and the caller reports what it got.
    """
    images: list[bytes] = []

    document = pdfium.PdfDocument(pdf_bytes)
    page_count = 0
    try:
        page_count = len(document)

        for index in range(page_count):
            if index >= max_pages:
                break

            page = document[index]
            bitmap = None
            try:
                bitmap = page.render(scale=scale)
                image = bitmap.to_pil()
                buffer = io.BytesIO()
                image.save(buffer, format="PNG")
                images.append(buffer.getvalue())
            except Exception:  # pragma: no cover - a damaged page is rare
                break
            finally:
                if bitmap is not None:
                    bitmap.close()
                page.close()
    finally:
        document.close()

    return page_count, images


def encode(image: bytes) -> str:
    """Encode a PNG so it can travel inside JSON."""
    return base64.b64encode(image).decode("ascii")
