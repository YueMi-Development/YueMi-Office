"""Tests for bundled fonts and the warnings the render service reports."""

from __future__ import annotations

import base64
import io
from pathlib import Path

import pytest
from pypdf import PdfReader

from app.models import Project, ProjectFile, ProjectFont, RenderWarning
from app.render import fonts as font_tools
from app.render.pipeline import render_project

#: The bundled fonts that ship with the reference project.
FONT_DIR = Path(__file__).resolve().parent / "fixtures" / "reference" / "fonts"


def _font(path: str) -> ProjectFont:
    """Read one of the bundled fonts the way the app would send it."""
    data = (FONT_DIR / path).read_bytes()
    return ProjectFont(
        path=f"fonts/{path}",
        base64=base64.b64encode(data).decode("ascii"),
        mimeType="font/woff2",
    )


def _render(
    css: str,
    markdown: str = "# Title\n\nSome text.\n",
    fonts: list[ProjectFont] | None = None,
):
    """Render a small document and return the result."""
    return render_project(
        Project(content=["content/doc.md"], styles=["styles/main.css"]),
        [
            ProjectFile(path="content/doc.md", text=markdown),
            ProjectFile(path="styles/main.css", text=css),
        ],
        [],
        fonts or [],
    )


def _font_names(pdf: bytes) -> set[str]:
    """The names of the fonts embedded in a PDF."""
    reader = PdfReader(io.BytesIO(pdf))
    names: set[str] = set()
    for page in reader.pages:
        resources = page.get("/Resources")
        if not resources:
            continue
        font_resources = resources.get_object().get("/Font")
        if not font_resources:
            continue
        for entry in font_resources.get_object().values():
            base = entry.get_object().get("/BaseFont")
            if base:
                names.add(str(base).lstrip("/"))
    return names


def test_font_face_rule_uses_the_family_from_the_font():
    rules, families = font_tools.font_face_rules([_font("inter-400.woff2")])

    assert families == ["Inter"]
    assert len(rules) == 1
    assert "font-family: 'Inter'" in rules[0]
    assert "font-weight: normal" in rules[0]


def test_font_face_rule_reads_the_weight_from_the_font():
    rules, _ = font_tools.font_face_rules([_font("inter-700.woff2")])

    assert "font-weight: bold" in rules[0]


def test_font_face_rule_reads_the_style_from_the_font():
    rules, _ = font_tools.font_face_rules([_font("source-serif-4-400-italic.woff2")])

    assert "font-style: italic" in rules[0]


def test_woff2_is_converted_to_truetype():
    """WeasyPrint cannot read WOFF2, so the font has to be converted."""
    data, info = font_tools.prepare_font(_font("inter-400.woff2"))

    assert data[:4] == b"\x00\x01\x00\x00"
    assert info.family == "Inter"


def test_a_bundled_font_is_used_in_the_output():
    result = _render(
        'body { font-family: "Inter"; }',
        fonts=[_font("inter-400.woff2")],
    )

    names = _font_names(result.pdf)
    assert any("Inter" in name for name in names), names


def test_a_document_without_fonts_still_renders():
    result = _render('body { font-family: "Inter"; }')

    assert len(result.pdf) > 0


def test_an_unbundled_family_is_reported():
    result = _render('body { font-family: "Some Missing Face"; }')

    codes = [warning.code for warning in result.warnings]
    assert "font.unresolved" in codes


def test_a_bundled_family_is_not_reported():
    result = _render(
        'body { font-family: "Inter"; }',
        fonts=[_font("inter-400.woff2")],
    )

    codes = [warning.code for warning in result.warnings]
    assert "font.unresolved" not in codes


def test_a_generic_family_is_never_reported():
    result = _render("body { font-family: serif, sans-serif; }")

    codes = [warning.code for warning in result.warnings]
    assert "font.unresolved" not in codes


def test_the_warning_points_at_the_stylesheet():
    result = _render('body { font-family: "Some Missing Face"; }')

    warning = next(
        warning for warning in result.warnings if warning.code == "font.unresolved"
    )
    assert warning.path == "styles/main.css"


def test_a_missing_content_file_is_reported():
    result = render_project(
        Project(content=["content/doc.md", "content/gone.md"], styles=[]),
        [ProjectFile(path="content/doc.md", text="# Title")],
        [],
        [],
    )

    warning = next(
        warning for warning in result.warnings if warning.code == "content.missing"
    )
    assert warning.path == "content/gone.md"


def test_a_missing_asset_is_reported():
    result = _render(
        "body { background-image: url('assets/absent.png'); }",
    )

    codes = [warning.code for warning in result.warnings]
    assert "asset.missing" in codes


def test_a_wide_table_is_reported_as_overflowing():
    result = _render(
        """
        body { margin: 0; font-size: 11pt; }
        table { width: 100%; table-layout: fixed; }
        td { white-space: nowrap; }
        """,
        markdown=(
            "| A | B |\n| --- | --- |\n| " + "x" * 400 + " | y |\n"
        ),
    )

    codes = [warning.code for warning in result.warnings]
    assert "layout.overflow" in codes


def test_a_table_that_fits_is_not_reported_as_overflowing():
    result = _render(
        """
        body { margin: 0; font-size: 11pt; }
        table { width: 100%; table-layout: fixed; }
        td { white-space: nowrap; }
        """,
        markdown="| A | B |\n| --- | --- |\n| short | y |\n",
    )

    codes = [warning.code for warning in result.warnings]
    assert "layout.overflow" not in codes


def test_a_heading_left_alone_at_the_bottom_is_reported():
    result = _render(
        """
        body { margin: 0; font-size: 11pt; }
        h2 { break-after: auto; margin: 0; }
        """,
        markdown=(
            '<div style="height: 920px"></div>\n\n## A section\n\n'
            '<div style="break-before: page">Next page.</div>\n'
        ),
    )

    codes = [warning.code for warning in result.warnings]
    assert "heading.orphan" in codes


def test_the_orphan_warning_names_the_heading():
    result = _render(
        """
        body { margin: 0; font-size: 11pt; }
        h2 { break-after: auto; margin: 0; }
        """,
        markdown=(
            '<div style="height: 920px"></div>\n\n## A section\n\n'
            '<div style="break-before: page">Next page.</div>\n'
        ),
    )

    warning = next(
        warning for warning in result.warnings if warning.code == "heading.orphan"
    )
    assert "A section" in warning.message


def test_a_document_without_problems_reports_nothing():
    result = _render(
        """
        body { margin: 0; font-size: 11pt; }
        h2 { break-after: avoid; }
        """,
        markdown="# Title\n\nSome text.\n\n## A section\n\nMore text.\n",
    )

    assert result.warnings == []
