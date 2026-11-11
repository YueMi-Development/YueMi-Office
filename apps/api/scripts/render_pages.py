"""Render a project folder and write its pages as images.

This is what the CI job that runs the reference document on several operating
systems uses: it renders the project the way the app does, then writes one
PNG per page so the pages can be compared against the committed baselines.

    python scripts/render_pages.py <project> <output directory>
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tests.visual_helpers import render_folder  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", help="the project folder to render")
    parser.add_argument("output", help="the folder the pages are written to")
    arguments = parser.parse_args()

    project = Path(arguments.project)
    output = Path(arguments.output)

    if not project.is_dir():
        print(f"the project is missing: {project}")
        return 1

    rendered = render_folder(project)

    output.mkdir(parents=True, exist_ok=True)
    for index, image in enumerate(rendered.page_images, start=1):
        (output / f"page-{index}.png").write_bytes(image)

    print(f"rendered {len(rendered.page_images)} pages into {output}")
    print(f"sha256: {rendered.sha256}")
    for warning in rendered.warnings:
        print(f"warning: {warning['code']} {warning['message']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
