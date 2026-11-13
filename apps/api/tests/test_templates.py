"""Rendering the bundled templates the way the app does.

The templates are part of the product, so they are checked the same way the
reference document is: no font may come from the machine, because a font that
is not bundled renders differently on every operating system, which is what
PRD section 8 forbids.
"""

from __future__ import annotations

import base64
import io
import json
from pathlib import Path

import pytest
from pypdf import PdfReader

from app.models import Project, ProjectFile, ProjectFont
from app.render.pipeline import render_project

#: Where the desktop app keeps its templates.
TEMPLATE_DIR = (
    Path(__file__).resolve().parents[3]
    / "apps"
    / "desktop"
    / "src"
    / "features"
    / "templates"
)

#: Where the bundled fonts live in the repository.
FONT_DIR = Path(__file__).resolve().parents[3] / "apps" / "desktop" / "public" / "fonts"

#: The names of the fonts that are bundled with the app.
BUNDLED_FONTS = {
    "inter-400.woff2",
    "inter-700.woff2",
    "source-serif-4-400.woff2",
    "source-serif-4-400-italic.woff2",
}

#: The fonts that a machine is likely to have, and that must never appear in
#: a document that bundles its own fonts.
MACHINE_FONTS = (
    "DejaVu",
    "Noto",
    "Liberation",
    "Arial",
    "Times",
    "Courier",
    "Helvetica",
    "Verdana",
    "Tahoma",
    "Trebuchet",
    "Calibri",
    "Cambria",
    "Segoe",
)


def _definitions() -> dict[str, dict]:
    """The templates as the app defines them."""
    raw = (TEMPLATE_DIR / "content.json").read_text(encoding="utf-8")
    return json.loads(raw)


def _render(template_id: str, definition: dict):
    """Render one template the way the app sends it."""
    files = [
        ProjectFile(path=path, text=text) for path, text in definition["files"].items()
    ]

    fonts: list[ProjectFont] = []
    for font in definition["fonts"]:
        name = font["path"].rsplit("/", 1)[-1]
        assert name in BUNDLED_FONTS, name
        data = (FONT_DIR / name).read_bytes()
        fonts.append(
            ProjectFont(
                path=font["path"],
                base64=base64.b64encode(data).decode("ascii"),
                mimeType="font/woff2",
            )
        )

    content = [path for path in definition["files"] if path.endswith(".md")]
    styles = [path for path in definition["files"] if path.endswith(".css")]

    project = Project(
        title=definition["name"],
        content=content,
        styles=styles,
        fonts=[font.path for font in fonts],
    )

    return render_project(project, files, [], fonts)


def _embedded_fonts(pdf_bytes: bytes) -> set[str]:
    """The names of the fonts embedded in a PDF."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    names: set[str] = set()
    for page in reader.pages:
        resources = page.get("/Resources")
        if not resources:
            continue
        fonts = resources.get_object().get("/Font")
        if not fonts:
            continue
        for entry in fonts.get_object().values():
            name = entry.get_object().get("/BaseFont")
            if name:
                # The name carries a subset prefix, as in "RQQJXR+Inter".
                names.add(str(name).split("+")[-1])
    return names


TEMPLATE_IDS = ["report", "resume", "article"]


def test_the_templates_are_the_ones_the_app_ships():
    definitions = _definitions()

    assert sorted(definitions) == sorted(TEMPLATE_IDS)


@pytest.mark.parametrize("template_id", TEMPLATE_IDS)
def test_a_template_renders(template_id):
    result = _render(template_id, _definitions()[template_id])

    assert result.pdf.startswith(b"%PDF")
    assert result.outline.pageCount >= 1


@pytest.mark.parametrize("template_id", TEMPLATE_IDS)
def test_a_template_bundles_every_font_it_uses(template_id):
    """No font may come from the machine."""
    result = _render(template_id, _definitions()[template_id])

    embedded = _embedded_fonts(result.pdf)
    assert embedded, "the template embedded no fonts at all"

    for name in embedded:
        for machine in MACHINE_FONTS:
            assert not name.startswith(machine), f"a machine font leaked in: {name}"


@pytest.mark.parametrize("template_id", TEMPLATE_IDS)
def test_a_template_renders_without_warnings(template_id):
    result = _render(template_id, _definitions()[template_id])

    assert result.warnings == [], [warning.model_dump() for warning in result.warnings]


@pytest.mark.parametrize("template_id", TEMPLATE_IDS)
def test_a_template_renders_the_same_every_time(template_id):
    definition = _definitions()[template_id]

    first = _render(template_id, definition)
    second = _render(template_id, definition)

    assert first.pdf == second.pdf
