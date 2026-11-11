"""Rendering a project folder the way the app does.

The visual tests need to render the same project the desktop app renders, so
this walks a project folder and builds the same request the app would send.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import mimetypes
from dataclasses import dataclass
from pathlib import Path

from app.models import (
    Project,
    ProjectAsset,
    ProjectFile,
    ProjectFont,
    RenderRequest,
)
from app.render.pipeline import render_project

#: Extensions the render service reads as text.
TEXT_EXTENSIONS = {".md", ".markdown", ".css", ".json", ".txt", ".yaml", ".yml"}

#: Extensions the render service reads as binary assets.
BINARY_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
    ".svg",
    ".ico",
    ".pdf",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".eot",
}


@dataclass
class RenderedProject:
    """A rendered project: the PDF, its pages as images, and its hash."""

    pdf: bytes
    page_images: list[bytes]
    sha256: str
    warnings: list[dict]


def load_project(root: Path) -> RenderRequest:
    """Read a project folder into a render request."""
    project_file = root / "project.json"
    if project_file.is_file():
        raw = json.loads(project_file.read_text(encoding="utf-8"))
        project = Project.model_validate(raw)
    else:
        project = Project()

    files: list[ProjectFile] = []
    assets: list[ProjectAsset] = []
    fonts: list[ProjectFont] = []

    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(root).as_posix()
        suffix = path.suffix.lower()

        if suffix in TEXT_EXTENSIONS:
            files.append(
                ProjectFile(path=relative, text=path.read_text(encoding="utf-8"))
            )
        elif suffix in BINARY_EXTENSIONS:
            data = path.read_bytes()
            encoded = base64.b64encode(data).decode("ascii")
            mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            if relative in set(project.fonts):
                fonts.append(
                    ProjectFont(path=relative, base64=encoded, mimeType=mime)
                )
            else:
                assets.append(
                    ProjectAsset(path=relative, base64=encoded, mimeType=mime)
                )

    return RenderRequest(
        project=project,
        files=files,
        assets=assets,
        fonts=fonts,
    )


def rasterize(pdf_bytes: bytes, zoom: float = 2.0) -> list[bytes]:
    """Turn each page of a PDF into a PNG image.

    PyMuPDF is used because it ships wheels for every platform CI runs on,
    which keeps the visual tests free of a system image library.
    """
    import fitz  # PyMuPDF

    document = fitz.open(stream=pdf_bytes, filetype="pdf")
    images: list[bytes] = []
    try:
        matrix = fitz.Matrix(zoom, zoom)
        for page in document:
            pixmap = page.get_pixmap(matrix=matrix)
            images.append(pixmap.tobytes("png"))
    finally:
        document.close()

    return images


def render_folder(root: Path) -> RenderedProject:
    """Render a project folder and rasterize its pages."""
    request = load_project(root)
    result = render_project(request.project, request.files, request.assets, request.fonts)

    return RenderedProject(
        pdf=result.pdf,
        page_images=rasterize(result.pdf),
        sha256=hashlib.sha256(result.pdf).hexdigest(),
        warnings=[warning.model_dump() for warning in result.warnings],
    )


def compare_images(
    baseline: bytes,
    actual: bytes,
) -> tuple[float, int, int]:
    """Compare two PNG images.

    Returns:
        The share of pixels that differ, the width and the height of the
        images.
    """
    import fitz  # PyMuPDF
    import numpy

    first = fitz.Pixmap(baseline)
    second = fitz.Pixmap(actual)

    if (first.width, first.height, first.n) != (
        second.width,
        second.height,
        second.n,
    ):
        return 1.0, second.width, second.height

    before = numpy.frombuffer(first.samples, dtype=numpy.uint8).reshape(
        first.height, first.width, first.n
    )
    after = numpy.frombuffer(second.samples, dtype=numpy.uint8).reshape(
        second.height, second.width, second.n
    )

    # A small difference in one channel is antialiasing, not a layout change.
    difference = numpy.abs(before.astype(int) - after.astype(int)).max(axis=2)
    changed = int((difference > 24).sum())
    total = int(difference.size)
    share = changed / total if total else 0.0

    return share, second.width, second.height
