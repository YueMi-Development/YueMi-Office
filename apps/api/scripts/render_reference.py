"""Regenerate the visual baselines for the reference document.

The baselines are the pages CI compares against. Run this after a change to
the layout engine that is meant to alter the output:

    python scripts/render_reference.py --update
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# The script is run from the API folder, so the app package is importable.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tests.visual_helpers import compare_images, render_folder  # noqa: E402

#: The project the baselines are made from.
REFERENCE_PROJECT = (
    Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "reference"
)

#: Where the baseline pages live.
BASELINE_DIR = Path(__file__).resolve().parents[1] / "tests" / "visual" / "baseline"

#: The share of pixels that may differ before the pages count as different.
TOLERANCE = 0.001


def baseline_dir(case: str) -> Path:
    """The folder holding the baseline pages of one case."""
    return BASELINE_DIR / case


def write_baselines(case: str, images: list[bytes], page_count: int) -> None:
    """Write the baseline pages and their manifest."""
    target = baseline_dir(case)
    target.mkdir(parents=True, exist_ok=True)

    for index, image in enumerate(images, start=1):
        (target / f"page-{index}.png").write_bytes(image)

    manifest = {
        "pageCount": page_count,
        "pages": [f"page-{index}.png" for index in range(1, len(images) + 1)],
    }
    (target / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )


def check_baselines(case: str, images: list[bytes]) -> list[str]:
    """Compare the rendered pages with the baselines.

    Returns:
        A description of every page that differs.
    """
    target = baseline_dir(case)
    problems: list[str] = []

    manifest_path = target / "manifest.json"
    if not manifest_path.is_file():
        return [f"no baselines for '{case}'; run scripts/render_reference.py --update"]

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected = manifest["pageCount"]
    if expected != len(images):
        problems.append(f"page count changed: expected {expected}, got {len(images)}")

    for index, image in enumerate(images, start=1):
        baseline_path = target / f"page-{index}.png"
        if not baseline_path.is_file():
            problems.append(f"missing baseline for page {index}")
            continue

        share, width, height = compare_images(baseline_path.read_bytes(), image)
        if share > TOLERANCE:
            problems.append(
                f"page {index} differs from the baseline "
                f"({share:.4%} of pixels, {width}x{height})"
            )

    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--update",
        action="store_true",
        help="write the baselines instead of comparing against them",
    )
    parser.add_argument(
        "--case",
        default="reference",
        help="the name of the case to work on",
    )
    arguments = parser.parse_args()

    if not REFERENCE_PROJECT.is_dir():
        print(f"the reference project is missing: {REFERENCE_PROJECT}")
        return 1

    rendered = render_folder(REFERENCE_PROJECT)
    print(f"rendered {len(rendered.page_images)} pages")
    print(f"sha256: {rendered.sha256}")
    for warning in rendered.warnings:
        print(f"warning: {warning['code']} {warning['message']}")

    if arguments.update:
        write_baselines(arguments.case, rendered.page_images, len(rendered.page_images))
        print(f"wrote baselines to {baseline_dir(arguments.case)}")
        return 0

    problems = check_baselines(arguments.case, rendered.page_images)
    for problem in problems:
        print(f"FAIL {problem}")

    if problems:
        return 1

    print("the rendered pages match the baselines")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
