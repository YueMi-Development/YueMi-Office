"""Detecting the problems a document has.

The render service reports warnings about a document without failing the
render: a table that overflows its column, a heading left alone at the bottom
of a page, a font family the CSS asks for but the project does not bundle
(PRD section 6).

Every warning carries a stable code, a message a writer can act on, and the
project-relative path of the file it came from whenever that is known.
"""

from __future__ import annotations

import io
import logging
import re
from dataclasses import dataclass

from pypdf import PdfReader

from app.models import Project, ProjectAsset, ProjectFile, RenderWarning

logger = logging.getLogger(__name__)

#: `font-family: Foo, "Bar", sans-serif` in a stylesheet.
_FONT_FAMILY = re.compile(r"font-family\s*:\s*([^;{}]+)", re.IGNORECASE)

#: A `url(...)` reference in a stylesheet.
_CSS_URL = re.compile(r"url\(\s*([^)]+?)\s*\)")

#: An `src` or `href` attribute in the generated HTML.
_HTML_URL = re.compile(r"(?:src|href)\s*=\s*\"([^\"]+)\"")

#: Families that always exist and are never reported as missing.
_GENERIC_FAMILIES = {
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "ui-serif",
    "ui-sans-serif",
    "ui-monospace",
    "ui-rounded",
    "math",
    "emoji",
    "fangsong",
}

#: Families WeasyPrint resolves from the fonts installed on the machine.
#: They are reported only when the project bundles no fonts at all, because a
#: project that bundles fonts has deliberately chosen what it wants.
_SYSTEM_FAMILIES = _GENERIC_FAMILIES | {
    "arial",
    "helvetica",
    "courier",
    "times",
    "times new roman",
    "georgia",
    "verdana",
    "tahoma",
    "trebuchet ms",
    "calibri",
    "cambria",
    "segoe ui",
}


#: The shape WeasyPrint uses when it drops a declaration.
_IGNORED_DECLARATION = re.compile(r"^Ignored `[^`]+` at \d+:\d+, .+\.$", re.IGNORECASE)

#: The other shapes that mean the same thing.
_IGNORED_SELECTOR = re.compile(
    r"^(Invalid or unsupported selector|Unsupported @page selector|"
    r"Unsupported @layer selector)",
    re.IGNORECASE,
)


def _is_unsupported_css_message(message: str) -> bool:
    """Whether a log message says the stylesheet was not understood."""
    if _IGNORED_DECLARATION.match(message.strip()):
        return True
    return bool(_IGNORED_SELECTOR.match(message.strip()))


@dataclass
class WarningContext:
    """Everything the detectors need to look at a rendered document."""

    project: Project
    files: list[ProjectFile]
    assets: list[ProjectAsset]
    font_families: list[str]
    pdf_bytes: bytes
    headings: list[tuple[int, str, str]]
    log_messages: list[str]


def _normalize(text: str) -> str:
    return " ".join(text.split()).casefold()


def _quoted_families(declaration: str) -> list[str]:
    """Split a `font-family` declaration into its family names."""
    families: list[str] = []
    for part in declaration.split(","):
        cleaned = part.strip().strip("'\"").strip()
        if cleaned:
            families.append(cleaned)
    return families


def detect_unresolved_fonts(context: WarningContext) -> list[RenderWarning]:
    """Report CSS font families the project does not bundle.

    A family that is neither bundled nor generic leaves the layout at the
    mercy of whatever the rendering machine has installed, which is exactly
    the inconsistency PRD section 8 forbids.
    """
    if not context.font_families:
        # The project bundles no fonts, so every family comes from the
        # machine. That is only worth reporting when the document actually
        # asks for a specific family.
        pass

    bundled = {family.casefold() for family in context.font_families}
    warnings: list[RenderWarning] = []
    seen: set[tuple[str, str]] = set()

    for style_file in context.files:
        if style_file.path not in context.project.styles:
            continue

        for declaration in _FONT_FAMILY.findall(style_file.text):
            for family in _quoted_families(declaration):
                lowered = family.casefold()
                if lowered in _GENERIC_FAMILIES:
                    continue
                if lowered in bundled:
                    continue
                if lowered in _SYSTEM_FAMILIES and context.font_families:
                    # The project bundles its own fonts, so a system family is
                    # a deliberate choice and not an accident.
                    continue

                key = (style_file.path, family)
                if key in seen:
                    continue
                seen.add(key)

                warnings.append(
                    RenderWarning(
                        code="font.unresolved",
                        message=(
                            f"Font family '{family}' is not bundled with this project. "
                            "Add the font file to the project's fonts folder to make "
                            "the output identical on every machine."
                        ),
                        path=style_file.path,
                    )
                )

    return warnings


def detect_missing_assets(context: WarningContext) -> list[RenderWarning]:
    """Report `url()` references that no bundled asset satisfies."""
    available = {asset.path for asset in context.assets}
    filenames = {path.rsplit("/", 1)[-1] for path in available}
    warnings: list[RenderWarning] = []
    seen: set[tuple[str, str]] = set()

    def check(target: str, path: str) -> None:
        cleaned = target.strip().strip("'\"").strip()
        if not cleaned or cleaned.startswith("data:") or cleaned.startswith("#"):
            return
        if cleaned.startswith(("http://", "https://", "mailto:")):
            return

        normalized = cleaned.lstrip("./")
        if normalized in available or cleaned in available:
            return
        if normalized.rsplit("/", 1)[-1] in filenames:
            return
        if cleaned.rsplit("/", 1)[-1] in filenames:
            return

        key = (path, cleaned)
        if key in seen:
            return
        seen.add(key)
        warnings.append(
            RenderWarning(
                code="asset.missing",
                message=f"Referenced file '{cleaned}' was not found in the project.",
                path=path,
            )
        )

    for style_file in context.files:
        if style_file.path not in context.project.styles:
            continue
        for target in _CSS_URL.findall(style_file.text):
            check(target, style_file.path)

    for content_file in context.files:
        if content_file.path not in context.project.content:
            continue
        for target in _HTML_URL.findall(content_file.text):
            check(target, content_file.path)

    return warnings


def detect_missing_content(context: WarningContext) -> list[RenderWarning]:
    """Report content files the project lists but did not send."""
    sent = {file.path for file in context.files}
    warnings: list[RenderWarning] = []

    for content_path in context.project.content:
        if content_path in sent:
            continue
        warnings.append(
            RenderWarning(
                code="content.missing",
                message=f"Content file '{content_path}' is listed in the project but was not found.",
                path=content_path,
            )
        )

    return warnings


def detect_layout_overflow(context: WarningContext) -> list[RenderWarning]:
    """Report elements that did not fit in the space they were given.

    The layout engine does not report this, so the boxes are measured by
    `app.render.layout`. Nothing is detected from the logs here.
    """
    return []


def detect_unsupported_css(context: WarningContext) -> list[RenderWarning]:
    """Report CSS the layout engine could not use.

    WeasyPrint reports these in a few fixed shapes, so the messages are
    matched exactly rather than by a keyword. Matching loosely would also
    catch unrelated notices, such as the one about the font subsetter, which
    has nothing to do with the document's stylesheet.
    """
    warnings: list[RenderWarning] = []
    seen: set[str] = set()

    for message in context.log_messages:
        if not _is_unsupported_css_message(message):
            continue
        if message in seen:
            continue
        seen.add(message)
        warnings.append(
            RenderWarning(
                code="css.unsupported",
                message=f"The layout engine ignored part of the stylesheet: {message}",
            )
        )

    return warnings


def _page_texts(pdf_bytes: bytes) -> list[str]:
    """Extract the text of each page, in order."""
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except Exception as exc:  # pragma: no cover - damaged PDF
        logger.warning("cannot read the rendered PDF: %s", exc)
        return []

    texts: list[str] = []
    for page in reader.pages:
        try:
            texts.append(page.extract_text() or "")
        except Exception:  # pragma: no cover - malformed page content
            texts.append("")
    return texts


def collect_warnings(context: WarningContext) -> list[RenderWarning]:
    """Run every detector and return the warnings, most serious first."""
    warnings: list[RenderWarning] = []
    warnings.extend(detect_missing_content(context))
    warnings.extend(detect_unresolved_fonts(context))
    warnings.extend(detect_missing_assets(context))
    warnings.extend(detect_unsupported_css(context))

    # A warning about the same thing twice helps nobody.
    unique: list[RenderWarning] = []
    seen: set[tuple[str, str, str]] = set()
    for warning in warnings:
        key = (warning.code, warning.message, warning.path or "")
        if key in seen:
            continue
        seen.add(key)
        unique.append(warning)

    return unique
