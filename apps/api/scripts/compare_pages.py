"""Compare two sets of rendered pages.

The visual tests compare a render against the committed baselines. This
script compares two renders against each other, which is what the CI job
that runs the reference document on several operating systems uses.

    python scripts/compare_pages.py <expected> <actual>
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tests.visual_helpers import compare_images  # noqa: E402

#: The share of pixels that may differ before the pages count as different.
#: Antialiasing differs slightly between the platforms' font rasterisers.
TOLERANCE = 0.002


def page_number(path: Path) -> int:
    """The number in the name of a page image."""
    suffix = path.stem.split("-")[-1]
    return int(suffix) if suffix.isdigit() else 0


def page_files(directory: Path) -> list[Path]:
    """The page images in a directory, in order.

    The order is the number in the name rather than the name itself, because
    the names are sorted as text otherwise, and "page-10" comes before
    "page-2" that way.
    """
    return sorted(directory.glob("page-*.png"), key=page_number)


def compare_directories(expected: Path, actual: Path, tolerance: float = TOLERANCE) -> list[str]:
    """Compare the pages of two directories.

    Args:
        expected: The directory holding the expected pages.
        actual: The directory holding the rendered pages.
        tolerance: The share of pixels that may differ before a page counts
            as different.

    Returns:
        A description of every difference.
    """
    problems: list[str] = []

    expected_pages = page_files(expected)
    actual_pages = page_files(actual)

    if len(expected_pages) != len(actual_pages):
        problems.append(
            f"page count differs: expected {len(expected_pages)}, got {len(actual_pages)}"
        )

    for index, expected_page in enumerate(expected_pages):
        if index >= len(actual_pages):
            break
        actual_page = actual_pages[index]

        share, width, height = compare_images(
            expected_page.read_bytes(), actual_page.read_bytes()
        )
        if share > tolerance:
            problems.append(
                f"page {index + 1} differs ({share:.4%} of pixels, {width}x{height})"
            )

    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("expected", help="the directory holding the expected pages")
    parser.add_argument("actual", help="the directory holding the rendered pages")
    parser.add_argument(
        "--tolerance",
        type=float,
        default=TOLERANCE,
        help=(
            "the share of pixels that may differ before a page counts as "
            f"different (default {TOLERANCE})"
        ),
    )
    arguments = parser.parse_args()

    expected = Path(arguments.expected)
    actual = Path(arguments.actual)

    if not expected.is_dir():
        print(f"the expected pages are missing: {expected}")
        return 1

    problems = compare_directories(expected, actual, arguments.tolerance)
    for problem in problems:
        print(f"FAIL {problem}")

    if problems:
        return 1

    print(f"the pages in {actual} match {expected}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
