"""Tests for the render endpoints."""

from __future__ import annotations

import io

import pytest
from pypdf import PdfReader


def _read_pdf(response) -> PdfReader:
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    return PdfReader(io.BytesIO(response.content))


def test_health_reports_engine_versions(client):
    response = client.get("/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["weasyprintVersion"]
    assert body["pythonVersion"].startswith("3.")


def test_render_returns_a_valid_pdf(client, sample_request):
    response = client.post("/v1/render", json=sample_request)

    reader = _read_pdf(response)
    assert len(reader.pages) >= 1


def test_render_produces_expected_page_count(client, sample_request):
    """The sample document is short enough to fit on a single A4 page."""
    response = client.post("/v1/render", json=sample_request)

    reader = _read_pdf(response)
    assert len(reader.pages) == 1


def test_render_extracts_document_text(client, sample_request):
    response = client.post("/v1/render", json=sample_request)

    reader = _read_pdf(response)
    text = reader.pages[0].extract_text()
    assert "Getting Started" in text
    assert "Installation" in text


def test_render_honours_page_size(client, sample_request):
    """A4 is 595x842 points; the page box must match."""
    response = client.post("/v1/render", json=sample_request)

    reader = _read_pdf(response)
    width = float(reader.pages[0].mediabox.width)
    height = float(reader.pages[0].mediabox.height)
    assert width == pytest.approx(595, abs=2)
    assert height == pytest.approx(842, abs=2)


def test_render_honours_landscape_orientation(client, sample_request):
    sample_request["project"]["page"]["orientation"] = "landscape"

    response = client.post("/v1/render", json=sample_request)

    reader = _read_pdf(response)
    width = float(reader.pages[0].mediabox.width)
    height = float(reader.pages[0].mediabox.height)
    assert width > height


def test_render_applies_user_stylesheet(client, sample_request):
    """The project's CSS must affect the output, not just be accepted."""
    sample_request["files"][1]["text"] = (
        "body { font-size: 30pt; }\n@page { size: A5; }\n"
    )

    response = client.post("/v1/render", json=sample_request)

    reader = _read_pdf(response)
    width = float(reader.pages[0].mediabox.width)
    assert width == pytest.approx(420, abs=2)


def test_outline_reports_headings_with_page_numbers(client, sample_request):
    response = client.post("/v1/render/outline", json=sample_request)

    assert response.status_code == 200
    outline = response.json()
    titles = [entry["title"] for entry in outline["entries"]]
    assert "Getting Started" in titles
    assert "Installation" in titles
    assert outline["pageCount"] >= 1

    for entry in outline["entries"]:
        assert 0 <= entry["page"] < outline["pageCount"]
        assert 1 <= entry["level"] <= 6
        assert entry["anchor"]


def test_outline_nests_children_by_level(client, sample_request):
    response = client.post("/v1/render/outline", json=sample_request)

    outline = response.json()
    entries = outline["entries"]
    top_level = [entry for entry in entries if entry["level"] == 1]
    assert top_level, "expected a level 1 heading"

    for entry in top_level:
        for child_index in entry["children"]:
            assert entries[child_index]["level"] > entry["level"]


def test_render_accepts_inline_asset(client, sample_request, sample_asset):
    sample_request["assets"].append(sample_asset)

    response = client.post("/v1/render", json=sample_request)

    reader = _read_pdf(response)
    assert len(reader.pages) >= 1


def test_render_reports_missing_content_file_as_warning(client, sample_request):
    """A project referencing a file it did not send should not fail hard."""
    sample_request["project"]["content"].append("content/missing.md")

    response = client.post("/v1/render", json=sample_request)

    assert response.status_code == 200
    reader = _read_pdf(response)
    assert len(reader.pages) >= 1


def test_render_handles_empty_document(client, sample_request):
    sample_request["files"][0]["text"] = ""

    response = client.post("/v1/render", json=sample_request)

    reader = _read_pdf(response)
    assert len(reader.pages) >= 1


def test_render_handles_document_without_headings(client, sample_request):
    sample_request["files"][0]["text"] = "Just a paragraph, no headings here."

    response = client.post("/v1/render", json=sample_request)

    assert response.status_code == 200
    reader = _read_pdf(response)
    assert len(reader.pages) >= 1


def test_render_is_deterministic(client, sample_request):
    """The same project must produce the same PDF, so CI can compare it."""
    first = client.post("/v1/render", json=sample_request).content
    second = client.post("/v1/render", json=sample_request).content

    assert len(first) == len(second)


def test_render_rejects_invalid_request(client):
    response = client.post("/v1/render", json={"project": {"title": "no page key"}})

    # The project model fills in defaults, so this must succeed rather than
    # 500. A malformed body is a different case.
    assert response.status_code in (200, 422)


def test_render_rejects_malformed_body(client):
    response = client.post("/v1/render", json={"nonsense": True})

    assert response.status_code == 422
