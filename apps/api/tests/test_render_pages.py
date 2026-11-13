"""Tests for the rendered pages the assistant looks at."""

from __future__ import annotations

import base64

from fastapi.testclient import TestClient


class TestRenderPages:
    def test_returns_a_page_for_the_document(self, client: TestClient, sample_request: dict):
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

        assert "warnings" in response.json()
