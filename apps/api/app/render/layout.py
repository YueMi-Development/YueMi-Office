"""Looking at the laid-out document to find what is wrong with it.

WeasyPrint lays a document out into a tree of boxes before it writes the PDF.
That tree knows exactly where every element ended up on the page, which is
what makes it possible to say "this table is wider than the page" or "this
heading is the last thing on the page" rather than guessing from log text.

The measurements are in CSS pixels, the unit the layout engine works in.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from weasyprint.formatting_structure.boxes import BlockLevelBox

from app.models import RenderWarning

logger = logging.getLogger(__name__)

#: How far past the edge of the content area an element may reach before it
#: counts as overflowing. A fraction of a point covers rounding.
OVERFLOW_TOLERANCE = 1.0

#: The heading levels that can be left alone at the bottom of a page.
HEADING_TAGS = ("h1", "h2", "h3", "h4", "h5", "h6")


@dataclass(frozen=True)
class PageGeometry:
    """The area of a page that content is laid out in."""

    left: float
    top: float
    right: float
    bottom: float


def page_geometry(page) -> PageGeometry:
    """The content area of a page, without its margins."""
    box = page._page_box
    left = box.margin_left
    top = box.margin_top
    return PageGeometry(
        left=left,
        top=top,
        right=left + box.padding_width(),
        bottom=top + box.padding_height(),
    )


def _is_margin_box(box) -> bool:
    """Whether a box is a running header or footer.

    Those live outside the content area on purpose, so they must not be
    reported as overflowing it.
    """
    return type(box).__name__ == "MarginBox"


def _is_block_level(box) -> bool:
    """Whether a box is a block-level box.

    The check is made on the box's own class rather than on its tag, because
    the same element produces different boxes depending on how it is styled.
    """
    return isinstance(box, BlockLevelBox)


def _content_boxes(page) -> list:
    """The block-level boxes on a page, in document order.

    Running headers and footers are left out: they are not part of the
    document's flow.
    """
    return [
        box
        for box in page._page_box.descendants()
        if _is_block_level(box) and not _is_margin_box(box)
    ]


def _box_text(box) -> str:
    """The text of a box, on one line.

    Some boxes have no element behind them, and asking those for their text
    fails, so they are treated as empty.
    """
    try:
        text = box.content_text or ""
    except AttributeError:
        return ""
    return " ".join(text.split())


def _tag(box) -> str | None:
    """The tag of the element a box belongs to."""
    tag = getattr(box, "element_tag", None)
    return str(tag) if tag else None


def _element_description(box) -> str:
    """A short description of the element a box belongs to."""
    element = getattr(box, "element", None)
    tag = _tag(box) or "element"
    if element is not None and hasattr(element, "get"):
        identifier = element.get("id")
        if identifier:
            return f"{tag}#{identifier}"
    return str(tag)


def _overflowing_boxes(page, geometry: PageGeometry) -> list:
    """The boxes on a page that reach past the content area."""
    overflowing = []

    for box in page._page_box.descendants():
        if _is_margin_box(box):
            continue
        tag = _tag(box)
        if not tag or tag in ("html", "body"):
            # The root boxes are as wide as the page by definition.
            continue

        left = box.position_x
        right = box.position_x + box.width
        bottom = box.position_y + box.height

        if (
            right > geometry.right + OVERFLOW_TOLERANCE
            or left < geometry.left - OVERFLOW_TOLERANCE
            or bottom > geometry.bottom + OVERFLOW_TOLERANCE
        ):
            overflowing.append(box)

    return overflowing


def _innermost(boxes: list) -> list:
    """Keep only the boxes that have no overflowing box inside them."""
    inner = []

    for box in boxes:
        contains_another = any(
            other is not box and other in box.descendants() for other in boxes
        )
        if not contains_another:
            inner.append(box)

    return inner


def detect_overflow(document) -> list[RenderWarning]:
    """Report elements that spill past the edge of the page.

    A table with a column that cannot shrink, or an image wider than the
    text column, ends up running into the margin or off the page. The layout
    engine does not report this, so the boxes are measured here.
    """
    warnings: list[RenderWarning] = []
    seen: set[str] = set()

    for index, page in enumerate(document.pages):
        geometry = page_geometry(page)
        overflowing = _innermost(_overflowing_boxes(page, geometry))

        for box in overflowing:
            description = _element_description(box)
            if description in seen:
                continue
            seen.add(description)

            warnings.append(
                RenderWarning(
                    code="layout.overflow",
                    message=(
                        f"The '{description}' element on page {index + 1} is wider "
                        "than the text area and spills into the margin. Reduce its "
                        "width, or let it wrap."
                    ),
                )
            )

    return warnings


def detect_orphaned_headings(
    document, heading_paths: dict[str, str]
) -> list[RenderWarning]:
    """Report headings that sit alone at the bottom of a page.

    A heading with its text overleaf reads badly, so the layout engine's
    usual advice is to keep the two together.

    The test is structural rather than positional: a heading is reported when
    it is the last block on its page and the document continues on a later
    page. Measuring how close the heading sits to the bottom instead would
    make the answer depend on which font the machine resolved, and therefore
    differ between operating systems.

    Args:
        document: The laid-out document.
        heading_paths: The file each heading's text came from.
    """
    blocks: list[tuple[int, object]] = [
        (page_index, box)
        for page_index, page in enumerate(document.pages)
        for box in _content_boxes(page)
    ]

    warnings: list[RenderWarning] = []

    for position, (page_index, box) in enumerate(blocks):
        if _tag(box) not in HEADING_TAGS:
            continue

        # A heading with anything below it on the same page is not alone.
        following = blocks[position + 1] if position + 1 < len(blocks) else None
        if following is not None and following[0] == page_index:
            continue

        # A heading at the very end of the document has no text to be
        # separated from, so there is nothing to report.
        if following is None:
            continue

        text = _box_text(box)
        warnings.append(
            RenderWarning(
                code="heading.orphan",
                message=(
                    f"The heading '{text}' on page {page_index + 1} is the last thing "
                    "on the page. Keep it with the text below it, or start the "
                    "section on a new page."
                ),
                path=heading_paths.get(text),
            )
        )

    return warnings


def analyze_layout(
    document, heading_paths: dict[str, str] | None = None
) -> list[RenderWarning]:
    """Run every layout check over a rendered document."""
    warnings: list[RenderWarning] = []
    warnings.extend(detect_overflow(document))
    warnings.extend(detect_orphaned_headings(document, heading_paths or {}))
    return warnings
