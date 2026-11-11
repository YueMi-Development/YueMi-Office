"""Tests for the project format handling."""

from __future__ import annotations

from app.models import PROJECT_SCHEMA_VERSION, Project, RenderRequest
from app.render.pipeline import _slugify


def test_project_defaults_are_filled_in():
    project = Project()

    assert project.schemaVersion == PROJECT_SCHEMA_VERSION
    assert project.page.size == "A4"
    assert project.page.orientation == "portrait"
    assert project.pdf.variant is None
    assert project.content == []
    assert project.styles == []
    assert project.fonts == []


def test_project_keeps_the_fonts_it_lists():
    project = Project(fonts=["fonts/inter-400.woff2"])

    assert project.fonts == ["fonts/inter-400.woff2"]


def test_project_rejects_unknown_page_size():
    from pydantic import ValidationError

    try:
        Project(page={"size": "A99"})
    except ValidationError:
        return
    raise AssertionError("expected a validation error for an unknown page size")


def test_render_request_accepts_a_minimal_payload():
    request = RenderRequest(project=Project())

    assert request.files == []
    assert request.assets == []
    assert request.fonts == []


def test_slugify_produces_url_safe_anchors():
    assert _slugify("Getting Started", set()) == "getting-started"
    assert _slugify("  Mixed   CASE  ", set()) == "mixed-case"
    assert _slugify("Symbols: &*@!", set()) == "symbols"


def test_slugify_disambiguates_duplicates():
    taken: set[str] = set()

    first = _slugify("Appendix", taken)
    second = _slugify("Appendix", taken)

    assert first == "appendix"
    assert second == "appendix-2"


def test_slugify_handles_empty_titles():
    assert _slugify("", set()) == "section"
    assert _slugify("---", set()) == "section"
