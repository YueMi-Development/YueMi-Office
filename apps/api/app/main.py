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
    header so the client can surface them without a second request.
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
        headers["X-Warnings"] = json.dumps(
            [warning.model_dump() for warning in result.warnings]
        )

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
