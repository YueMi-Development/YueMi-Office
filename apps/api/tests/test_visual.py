"""The visual regression tests.

The rendered pages of the reference document are compared with the baseline
images committed to the repository. A change to the layout engine that moves
anything on the page shows up here as a difference.

The baselines are regenerated with:

    python scripts/render_reference.py --update
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tests.visual_helpers import compare_images, render_folder

#: The project the baselines are made from.
REFERENCE_PROJECT = Path(__file__).resolve().parent / "fixtures" / "reference"

#: Where the baseline pages live.
BASELINE_DIR = Path(__file__).resolve().parent / "visual" / "baseline" / "reference"

#: The share of pixels that may differ before the pages count as different.
TOLERANCE = 0.001


@pytest.fixture(scope="module")
def rendered():
    """The rendered reference document."""
    if not REFERENCE_PROJECT.is_dir():
        pytest.skip(f"the reference project is missing: {REFERENCE_PROJECT}")
    return render_folder(REFERENCE_PROJECT)


def test_the_reference_project_renders_more_than_one_page(rendered):
    assert len(rendered.page_images) >= 2


def test_the_reference_project_renders_without_warnings(rendered):
    assert rendered.warnings == [], rendered.warnings


def test_the_baselines_are_committed():
    manifest = BASELINE_DIR / "manifest.json"
    assert manifest.is_file(), (
        "the visual baselines are missing; run scripts/render_reference.py --update"
    )


def test_the_rendered_pages_match_the_baselines(rendered):
    manifest_path = BASELINE_DIR / "manifest.json"
    if not manifest_path.is_file():
        pytest.skip("the visual baselines are missing")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["pageCount"] == len(rendered.page_images), (
        "the page count changed; regenerate the baselines if that is intended"
    )

    problems: list[str] = []
    for index, image in enumerate(rendered.page_images, start=1):
        baseline_path = BASELINE_DIR / f"page-{index}.png"
        if not baseline_path.is_file():
            problems.append(f"page {index} has no baseline")
            continue

        share, width, height = compare_images(baseline_path.read_bytes(), image)
        if share > TOLERANCE:
            problems.append(
                f"page {index} differs from the baseline "
                f"({share:.4%} of pixels, {width}x{height})"
            )

    assert not problems, "\n".join(problems)


def test_the_rendered_pdf_is_deterministic(rendered):
    """The same project must produce the same bytes every time."""
    again = render_folder(REFERENCE_PROJECT)

    assert again.sha256 == rendered.sha256
