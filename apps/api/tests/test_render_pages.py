"""Tests for the rendered pages the assistant looks at."""

from __future__ import annotations

import base64
import io

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter

from app.render.pages import MAX_PAGES, encode, rasterize
from app.render.pipeline import RenderError


class TestRenderPages:
    def test_returns_a_page_for_the_document(
        self, client: TestClient, sample_request: dict
    ):
        response = client.post("/v1/render/pages", json=sample_request)

        assert response.status_code == 200
        body = response.json()
        assert body["pageCount"] == 1
        assert len(body["pages"]) == 1
        assert body["pages"][0]["index"] == 0

    def test_the_page_is_a_png(self, client: TestClient, sample_request: dict):
        response = client.post("/v1/render/pages", json=sample_request)

        png = base64.b64decode(response.json()["pages"][0]["pngBase64"])
        assert png.startswith(b"\x89PNG\r\n\x1a\n")

    def test_the_page_carries_the_warnings_of_the_render(
        self, client: TestClient, sample_request: dict
    ):
        response = client.post("/v1/render/pages", json=sample_request)

        # The warnings are looked at by their value, because a key that is
        # there says nothing about what is in it.
        warnings = response.json()["warnings"]
        assert isinstance(warnings, list)

    def test_the_warnings_of_the_render_are_the_ones_that_were_found(
        self, client: TestClient, sample_request: dict
    ):
        # A family the project does not bundle leaves the output at the
        # mercy of the machine, which is a warning the renderer gives.
        sample_request["files"][1]["text"] = "body { font-family: 'No Such Family'; }"

        response = client.post("/v1/render/pages", json=sample_request)

        warnings = response.json()["warnings"]
        codes = [warning["code"] for warning in warnings]
        assert "font.unresolved" in codes, warnings

        message = next(
            warning["message"]
            for warning in warnings
            if warning["code"] == "font.unresolved"
        )
        assert "No Such Family" in message, message

    def test_a_project_that_cannot_be_rendered_is_reported(
        self, client: TestClient, sample_request: dict, monkeypatch: pytest.MonkeyPatch
    ):
        def refuse(*_args, **_kwargs):
            raise RenderError("the stylesheet is not usable")

        monkeypatch.setattr("app.main.render_project", refuse)

        response = client.post("/v1/render/pages", json=sample_request)

        assert response.status_code == 422
        body = response.json()
        assert body["error"] == "render failed"
        assert "not usable" in body["details"]


class TestRasterize:
    def test_a_short_document_gives_every_page(self):
        pdf = _pdf_with_pages(3)

        count, images = rasterize(pdf)

        assert count == 3
        assert len(images) == 3

    def test_a_long_document_stops_at_the_limit(self):
        # The number of pages is what the document has, not what was drawn,
        # because the assistant is told how long the document is either way.
        pdf = _pdf_with_pages(MAX_PAGES + 4)

        count, images = rasterize(pdf)

        assert count == MAX_PAGES + 4
        assert len(images) == MAX_PAGES

    def test_the_pages_are_pngs(self):
        pdf = _pdf_with_pages(1)

        _, images = rasterize(pdf)

        assert images[0].startswith(b"\x89PNG\r\n\x1a\n")

    def test_a_page_encodes_back_to_the_same_bytes(self):
        pdf = _pdf_with_pages(1)

        _, images = rasterize(pdf)

        assert base64.b64decode(encode(images[0])) == images[0]


def _pdf_with_pages(count: int) -> bytes:
    """A PDF with the given number of empty pages."""
    writer = PdfWriter()
    for _ in range(count):
        writer.add_blank_page(width=200, height=200)

    buffer = io.BytesIO()
    writer.write(buffer)

    return buffer.getvalue()
