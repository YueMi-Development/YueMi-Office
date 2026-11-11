"""Bundled font handling.

A project may bundle its own font files so the document renders the same way
on every machine (PRD section 6). WeasyPrint reads fonts through Pango, which
does not reliably understand WOFF2, so the files are converted to plain TrueType
in memory before they are inlined.

The family, weight and style are read from the font's own tables rather than
guessed from the file name, so a document's CSS can refer to the family's real
name.
"""

from __future__ import annotations

import base64
import binascii
import io
import logging
from dataclasses import dataclass

from fontTools.ttLib import TTFont

from app.models import ProjectFont

logger = logging.getLogger(__name__)

#: Fallback family name when a font file cannot be inspected.
_FALLBACK_FAMILY = "Untitled Font"

#: Weight classes that CSS spells out rather than naming numerically.
_NAMED_WEIGHTS = {400: "normal", 700: "bold"}


@dataclass(frozen=True)
class FontInfo:
    """What a font file says about itself."""

    family: str
    weight: str
    style: str

    @property
    def css_family(self) -> str:
        """The family name as it should appear in a CSS `font-family`."""
        return self.family


def _decode(base64_data: str) -> bytes:
    return base64.b64decode(base64_data, validate=False)


def _is_woff2(data: bytes) -> bool:
    return data[:4] == b"wOF2"


def _is_woff(data: bytes) -> bool:
    return data[:4] == b"wOFF"


def _to_truetype(data: bytes) -> bytes:
    """Convert WOFF or WOFF2 data into plain TrueType bytes.

    The timestamp in the font's header is left alone: rewriting it would make
    the same font produce different bytes on every run, and the rendered PDF
    has to be identical every time.
    """
    with TTFont(io.BytesIO(data)) as font:
        font.flavor = None
        # The timestamp in the font's header is left alone: rewriting it would
        # make the same font produce different bytes on every run, and the
        # rendered PDF has to be identical every time.
        font.recalcTimestamp = False
        buffer = io.BytesIO()
        font.save(buffer)
        return buffer.getvalue()


def _name_from_table(font: TTFont) -> str:
    """Read the family name from the font's `name` table."""
    try:
        name_table = font["name"]
    except KeyError:
        return ""

    for name_id in (16, 1):
        # 16 is the typographic family; 1 is the legacy family name and is
        # what older tools still write.
        record = name_table.getDebugName(name_id)
        if record:
            return record.strip()

    return ""


def _weight_from_table(font: TTFont) -> str:
    """Read the weight from the font's OS/2 table."""
    try:
        weight_class = font["OS/2"].usWeightClass
    except (KeyError, AttributeError):
        return "normal"
    return _NAMED_WEIGHTS.get(weight_class, str(weight_class))


def _style_from_table(font: TTFont) -> str:
    """Read the style from the font's OS/2 table."""
    try:
        mac_style = font["head"].macStyle
    except (KeyError, AttributeError):
        return "normal"
    return "italic" if mac_style & 0x02 else "normal"


def inspect_font(data: bytes, fallback_family: str) -> FontInfo:
    """Describe a font file, falling back to the file name when unreadable."""
    try:
        with TTFont(io.BytesIO(data)) as font:
            family = _name_from_table(font) or fallback_family
            return FontInfo(
                family=family,
                weight=_weight_from_table(font),
                style=_style_from_table(font),
            )
    except Exception as exc:  # pragma: no cover - depends on the font file
        logger.warning("cannot inspect font %s: %s", fallback_family, exc)
        return FontInfo(family=fallback_family, weight="normal", style="normal")


def family_from_path(path: str) -> str:
    """Derive a family name from a font file path."""
    filename = path.rsplit("/", 1)[-1]
    stem = filename.rsplit(".", 1)[0]
    cleaned = "".join(
        character if character.isalnum() else " " for character in stem
    ).strip()
    return cleaned or _FALLBACK_FAMILY


def prepare_font(font: ProjectFont) -> tuple[bytes, FontInfo]:
    """Decode a bundled font and work out how it should be used.

    The font is converted to TrueType when needed, because that is the format
    WeasyPrint can hand to Pango reliably.

    Returns:
        The font bytes to inline, and the font's own description.
    """
    data = _decode(font.base64)

    if _is_woff2(data) or _is_woff(data):
        try:
            data = _to_truetype(data)
        except Exception as exc:
            logger.warning("cannot convert font %s: %s", font.path, exc)

    info = inspect_font(data, family_from_path(font.path))
    return data, info


def _data_uri(data: bytes) -> str:
    return f"data:font/ttf;base64,{base64.b64encode(data).decode('ascii')}"


def font_face_rules(fonts: list[ProjectFont]) -> tuple[list[str], list[str]]:
    """Build `@font-face` rules for the project's bundled fonts.

    Returns:
        The CSS rules, and the family names they define.
    """
    rules: list[str] = []
    families: list[str] = []

    for font in fonts:
        try:
            data, info = prepare_font(font)
        except (binascii.Error, ValueError) as exc:
            logger.warning("cannot decode font %s: %s", font.path, exc)
            continue

        families.append(info.family)
        rules.append(
            "@font-face {"
            f" font-family: '{info.family}';"
            f" src: url('{_data_uri(data)}');"
            f" font-weight: {info.weight};"
            f" font-style: {info.style};"
            "}"
        )

    return rules, families


def font_mime_types(fonts: list[ProjectFont]) -> dict[str, str]:
    """Map each font path to the MIME type of the bytes that get inlined."""
    return {font.path: "font/ttf" for font in fonts}
