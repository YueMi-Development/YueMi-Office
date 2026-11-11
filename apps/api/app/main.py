"""FastAPI application exposing the render service."""

from __future__ import annotations

import json
import logging
import platform

from app import native  # noqa: F401  (registers native library directories)

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from weasyprint import __version__ as weasyprint_version

from app.models import HealthResponse, RenderOutline, RenderRequest
from app.render.pipeline import RenderError, render_project

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

#: A header value has to stay small enough for every proxy in between. When
#: the payload is larger than this, the client is told to ask for it
#: separately instead of receiving a broken response.
MAX_HEADER_BYTES = 60_000


def _header_value(payload: object) -> str:
    """Encode a payload for a header, or return an empty string if too big."""
    encoded = json.dumps(payload, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > MAX_HEADER_BYTES:
        logger.warning("payload too large for a header; the client must fetch it separately")
        return ""
    return encoded


app = FastAPI(
    title="YueMi Render Service",
    version="0.1.0",
    description="Renders Markdown + CSS projects to PDF.",
)

# The desktop app runs on a custom protocol origin, so the renderer has to
# accept requests from it during development and from the packaged app.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "https://tauri.localhost",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    # Without this the browser hides the custom headers from the app, so the
    # preview would never see the warnings or the outline.
    expose_headers=["X-Warnings", "X-Outline"],
)


@app.get("/v1/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Report that the service is up and which engine version it uses."""
    return HealthResponse(
        status="ok",
        weasyprintVersion=weasyprint_version,
        pythonVersion=platform.python_version(),
    )


@app.post("/v1/render")
def render(request: RenderRequest) -> Response:
    """Render a project and return the PDF bytes.

    Warnings discovered during the render are attached as an `X-Warnings`
    header, and the outline as `X-Outline`, so the client can show a preview
    after a single request instead of rendering the document twice.
    """
    try:
        result = render_project(
            request.project, request.files, request.assets, request.fonts
        )
    except RenderError as exc:
        logger.exception("render failed")
        return Response(
            content=json.dumps({"error": "render failed", "details": str(exc)}),
            status_code=422,
            media_type="application/json",
        )

    headers = {}
    if result.warnings:
        warnings_header = _header_value(
            [warning.model_dump() for warning in result.warnings]
        )
        if warnings_header:
            headers["X-Warnings"] = warnings_header

    outline_header = _header_value(result.outline.model_dump())
    if outline_header:
        headers["X-Outline"] = outline_header

    return Response(content=result.pdf, media_type="application/pdf", headers=headers)


@app.post("/v1/render/outline", response_model=RenderOutline)
def render_outline(request: RenderRequest) -> RenderOutline:
    """Render a project and return only its outline.

    The outline's page numbers come from the rendered PDF, so they always
    match what the preview shows.
    """
    try:
        result = render_project(
            request.project, request.files, request.assets, request.fonts
        )
    except RenderError as exc:
        logger.exception("render failed")
        return Response(
            content=json.dumps({"error": "render failed", "details": str(exc)}),
            status_code=422,
            media_type="application/json",
        )

    return result.outline
