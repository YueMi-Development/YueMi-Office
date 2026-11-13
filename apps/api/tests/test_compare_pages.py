"""Tests for the comparison of rendered pages.

The visual tests compare a render against the committed baselines. The
script that does the comparing is used by CI to compare a render against a
render, so it is worth knowing that it says the right thing when the pages
differ and when they do not.

The images are made here rather than committed, because a fixture that is
an image can go stale against the library that reads it.
"""

from __future__ import annotations

import sys
from pathlib import Path

import fitz
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.compare_pages import compare_directories, page_files  # noqa: E402
from tests.visual_helpers import compare_images  # noqa: E402


def image(width: int, height: int, colour: tuple[int, int, int]) -> bytes:
    """An image of one colour."""
    pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, width, height), False)
    pixmap.set_rect(pixmap.irect, colour)
    return pixmap.tobytes("png")


def image_with_one_pixel_different(
    width: int, height: int, colour: tuple[int, int, int]
) -> bytes:
    """An image whose last pixel is a little different.

    The difference is past the point where a pixel counts as changed, but it
    is one pixel of many, which is what antialiasing looks like.
    """
    pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, width, height), False)
    pixmap.set_rect(pixmap.irect, colour)
    pixmap.set_pixel(width - 1, height - 1, (colour[0] - 40, colour[1], colour[2]))
    return pixmap.tobytes("png")


def image_with_a_row_different(
    width: int, height: int, colour: tuple[int, int, int]
) -> bytes:
    """An image whose last row is a lot different."""
    pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, width, height), False)
    pixmap.set_rect(pixmap.irect, colour)
    pixmap.set_rect(fitz.IRect(0, height - 1, width, height), (0, 0, 0))
    return pixmap.tobytes("png")


class TestPageFiles:
    def test_the_pages_are_found_in_order(self, tmp_path: Path):
        for name in ("page-2.png", "page-1.png", "page-10.png"):
            (tmp_path / name).write_bytes(b"")

        pages = page_files(tmp_path)

        assert [page.name for page in pages] == [
            "page-1.png",
            "page-2.png",
            "page-10.png",
        ]

    def test_other_files_are_left_out(self, tmp_path: Path):
        (tmp_path / "page-1.png").write_bytes(b"")
        (tmp_path / "page-1.json").write_bytes(b"")
        (tmp_path / "manifest.json").write_bytes(b"")
        (tmp_path / "notes.txt").write_bytes(b"")

        pages = page_files(tmp_path)

        assert [page.name for page in pages] == ["page-1.png"]


class TestCompareImages:
    def test_the_same_image_has_no_differing_pixels(self):
        picture = image(4, 4, (255, 255, 255))

        share, width, height = compare_images(picture, picture)

        assert share == 0.0
        assert (width, height) == (4, 4)

    def test_images_of_different_sizes_are_entirely_different(self):
        share, width, height = compare_images(
            image(4, 4, (255, 255, 255)), image(6, 4, (255, 255, 255))
        )

        assert share == 1.0
        assert (width, height) == (6, 4)

    def test_one_pixel_of_many_is_a_small_share(self):
        share, _, _ = compare_images(
            image_with_one_pixel_different(100, 100, (255, 255, 255)),
            image(100, 100, (255, 255, 255)),
        )

        assert share == pytest.approx(0.0001)

    def test_a_row_of_many_is_a_real_share(self):
        share, _, _ = compare_images(
            image_with_a_row_different(10, 10, (255, 255, 255)),
            image(10, 10, (255, 255, 255)),
        )

        assert share == pytest.approx(0.1)


class TestCompareDirectories:
    def write(self, directory: Path, pictures: list[bytes]) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        for index, picture in enumerate(pictures, start=1):
            (directory / f"page-{index}.png").write_bytes(picture)

    def test_matching_directories_report_nothing(self, tmp_path: Path):
        picture = image(4, 4, (255, 255, 255))
        self.write(tmp_path / "expected", [picture])
        self.write(tmp_path / "actual", [picture])

        assert compare_directories(tmp_path / "expected", tmp_path / "actual") == []

    def test_a_different_number_of_pages_is_reported(self, tmp_path: Path):
        picture = image(4, 4, (255, 255, 255))
        self.write(tmp_path / "expected", [picture, picture])
        self.write(tmp_path / "actual", [picture])

        problems = compare_directories(tmp_path / "expected", tmp_path / "actual")

        assert len(problems) == 1
        assert "page count differs" in problems[0]

    def test_a_differing_page_is_reported_by_its_number(self, tmp_path: Path):
        white = image(10, 10, (255, 255, 255))
        self.write(tmp_path / "expected", [white, white])
        self.write(
            tmp_path / "actual",
            [white, image_with_a_row_different(10, 10, (255, 255, 255))],
        )

        problems = compare_directories(tmp_path / "expected", tmp_path / "actual")

        assert len(problems) == 1
        assert problems[0].startswith("page 2 differs")

    def test_a_difference_under_the_tolerance_is_not_reported(self, tmp_path: Path):
        white = image(100, 100, (255, 255, 255))
        self.write(tmp_path / "expected", [white])
        self.write(
            tmp_path / "actual",
            [image_with_one_pixel_different(100, 100, (255, 255, 255))],
        )

        assert compare_directories(tmp_path / "expected", tmp_path / "actual") == []

    def test_the_tolerance_can_be_tightened(self, tmp_path: Path):
        white = image(100, 100, (255, 255, 255))
        self.write(tmp_path / "expected", [white])
        self.write(
            tmp_path / "actual",
            [image_with_one_pixel_different(100, 100, (255, 255, 255))],
        )

        problems = compare_directories(
            tmp_path / "expected", tmp_path / "actual", tolerance=0.0
        )

        assert len(problems) == 1
        assert problems[0].startswith("page 1 differs")
