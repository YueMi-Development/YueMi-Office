"""Markdown + CSS to PDF rendering.

The pipeline is:

1. Each content file is parsed from Markdown to HTML.
2. The HTML fragments are concatenated and wrapped in a document template that
   links the project's stylesheets and inlines its fonts and assets.
3. WeasyPrint lays the document out and writes the PDF.

Page geometry from `project.json` is injected as a `@page` rule *before* the
user's stylesheets, so project CSS can still override margins, headers and
footers (PRD section 6).
"""

from __future__ import annotations

import base64
import html as html_module
import io
import logging
import re
import warnings
from dataclasses import dataclass, field

from markdown_it import MarkdownIt
from weasyprint import HTML

from app.models import (
    OutlineEntry,
    PageConfig,
    Project,
    ProjectAsset,
    ProjectFile,
    ProjectFont,
    RenderOutline,
    RenderWarning,
)
from app.render import fonts as font_tools
from app.render.layout import analyze_layout
from app.render.warnings import WarningContext, collect_warnings

logger = logging.getLogger(__name__)

#: Anchors must be unique within a document and are used as PDF bookmark
#: targets, so they are restricted to characters that are safe in both a URL
#: fragment and a PDF named destination.
_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


class RenderError(Exception):
    """Raised when a project cannot be rendered at all."""


@dataclass
class RenderResult:
    """The outcome of one render."""

    pdf: bytes
    outline: RenderOutline
    warnings: list[RenderWarning] = field(default_factory=list)


def _slugify(text: str, taken: set[str]) -> str:
    """Turn heading text into a unique anchor.

    Duplicate headings are common in documents, so a numeric suffix is added
    when a slug is already in use.
    """
    slug = _SLUG_STRIP.sub("-", text.strip().lower()).strip("-")
    if not slug:
        slug = "section"
    candidate = slug
    counter = 2
    while candidate in taken:
        candidate = f"{slug}-{counter}"
        counter += 1
    taken.add(candidate)
    return candidate


def _build_markdown() -> MarkdownIt:
    """A Markdown parser configured for document authoring.

    `html=True` lets a project embed raw HTML, which authors expect from a
    document tool that also accepts CSS.
    """
    md = MarkdownIt("commonmark", {"html": True, "linkify": True, "typographer": True})
    md.enable(["table", "strikethrough"])
    return md


def _collect_headings_in_order(
    markdown_files: list[tuple[str, str]],
) -> list[tuple[int, str, str]]:
    """Headings in document order, handling both ATX and setext headings.

    Setext headings are detected by looking at a line and the underline that
    follows it, so the scan walks the file once.

    Each heading carries the file it came from, so a warning about it can
    point the writer at the right place.
    """
    headings: list[tuple[int, str, str]] = []
    for path, text in markdown_files:
        lines = text.splitlines()
        for index, line in enumerate(lines):
            atx = re.match(r"^(#{1,6})\s+(.+?)\s*#*\s*$", line)
            if atx:
                headings.append((len(atx.group(1)), atx.group(2).strip(), path))
                continue
            if index + 1 < len(lines):
                underline = lines[index + 1].strip()
                if underline and set(underline) in ({"="}, {"-"}):
                    title = line.strip()
                    if title:
                        level = 1 if underline[0] == "=" else 2
                        headings.append((level, title, path))
    return headings


def _page_rule(page: PageConfig) -> str:
    """Build the `@page` rule that sets the document's paper size."""
    size = page.size
    if page.orientation == "landscape":
        size = f"{size} landscape"
    return f"@page {{ size: {size}; }}"


def _data_uri(base64_data: str, mime_type: str) -> str:
    return f"data:{mime_type};base64,{base64_data}"


def _font_face_rules(fonts: list[ProjectFont]) -> tuple[list[str], list[str]]:
    """Build `@font-face` rules for the project's bundled fonts.

    Bundling fonts keeps output independent of what is installed on the
    rendering machine (PRD section 6).
    """
    return font_tools.font_face_rules(fonts)


def _asset_data_uris(assets: list[ProjectAsset]) -> dict[str, str]:
    """Map asset paths to data URIs so relative `url()` references resolve."""
    return {
        asset.path: _data_uri(asset.base64, asset.mimeType)
        for asset in assets
    }


def _rewrite_asset_urls(css: str, data_uris: dict[str, str]) -> str:
    """Rewrite `url(...)` references in CSS to point at inlined assets."""
    def replace(match: re.Match[str]) -> str:
        target = match.group(1).strip().strip("'\"")
        if target.startswith("data:"):
            return match.group(0)
        normalized = target.lstrip("./")
        for path, uri in data_uris.items():
            if normalized == path or normalized == path.rsplit("/", 1)[-1]:
                return f'url("{uri}")'
        return match.group(0)

    return re.sub(r"url\(\s*([^)]+?)\s*\)", replace, css)


def _rewrite_html_asset_urls(html: str, data_uris: dict[str, str]) -> str:
    """Rewrite `src`/`href` attributes pointing at project assets."""
    for path, uri in data_uris.items():
        filename = path.rsplit("/", 1)[-1]
        html = html.replace(f'src="{path}"', f'src="{uri}"')
        html = html.replace(f'src="./{path}"', f'src="{uri}"')
        html = html.replace(f'src="{filename}"', f'src="{uri}"')
        html = html.replace(f'href="{path}"', f'href="{uri}"')
    return html


def _render_html_document(
    project: Project,
    files: list[ProjectFile],
    assets: list[ProjectAsset],
    fonts: list[ProjectFont],
) -> tuple[str, list[str]]:
    """Build the full HTML document handed to WeasyPrint.

    Returns the document and the family names the bundled fonts define.
    """
    by_path = {file.path: file for file in files}
    md = _build_markdown()

    parts: list[str] = []
    for content_path in project.content:
        source = by_path.get(content_path)
        if source is None:
            logger.warning("content file missing from payload: %s", content_path)
            continue
        parts.append(md.render(source.text))

    body = "\n".join(parts)
    data_uris = _asset_data_uris(assets)
    body = _rewrite_html_asset_urls(body, data_uris)

    stylesheets: list[str] = []
    for style_path in project.styles:
        source = by_path.get(style_path)
        if source is None:
            logger.warning("stylesheet missing from payload: %s", style_path)
            continue
        stylesheets.append(_rewrite_asset_urls(source.text, data_uris))

    style_block = "\n".join(stylesheets)
    font_rules, font_families = _font_face_rules(fonts)
    font_block = "\n".join(font_rules)

    page_rule = _page_rule(project.page)
    title = html_module.escape(project.title)

    return f"""<!DOCTYPE html>
<html lang="{html_module.escape(project.language)}">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>
{page_rule}
{font_block}
</style>
<style>
{style_block}
</style>
</head>
<body>
{body}
</body>
</html>
""", font_families


def _extract_outline(pdf_bytes: bytes, headings: list[tuple[int, str, str]]) -> RenderOutline:
    """Read bookmarks and page numbers back out of the rendered PDF.

    WeasyPrint creates bookmarks from the headings, so reading them back gives
    page numbers that match the PDF exactly instead of a second guess.
    """
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf_bytes))
    page_count = len(reader.pages)

    entries: list[OutlineEntry] = []
    taken: set[str] = set()

    try:
        outline = reader.outline
    except Exception:  # pragma: no cover - pypdf raises on damaged outlines
        outline = []

    def walk(items: object, level: int) -> None:
        if not isinstance(items, list):
            return
        for item in items:
            if isinstance(item, list):
                walk(item, level + 1)
                continue
            try:
                page_number = reader.get_destination_page_number(item) + 1
            except Exception:  # pragma: no cover - malformed destination
                continue
            title = getattr(item, "title", "") or ""
            entries.append(
                OutlineEntry(
                    title=title,
                    level=max(1, min(6, level)),
                    page=max(0, page_number - 1),
                    anchor=_slugify(title, taken),
                    children=[],
                )
            )

    walk(outline, 1)

    if not entries and headings:
        # WeasyPrint did not produce bookmarks (for example when every heading
        # sits inside a section without a title). Fall back to the headings we
        # collected, with page 0, so the outline is still usable.
        for level, title, _path in headings:
            entries.append(
                OutlineEntry(
                    title=title,
                    level=level,
                    page=0,
                    anchor=_slugify(title, taken),
                    children=[],
                )
            )

    _link_children(entries)
    return RenderOutline(entries=entries, pageCount=page_count)


def _link_children(entries: list[OutlineEntry]) -> None:
    """Populate each entry's `children` list from the heading levels."""
    stack: list[int] = []
    for index, entry in enumerate(entries):
        while stack and entries[stack[-1]].level >= entry.level:
            stack.pop()
        if stack:
            entries[stack[-1]].children.append(index)
        stack.append(index)


def render_project(
    project: Project,
    files: list[ProjectFile],
    assets: list[ProjectAsset],
    fonts: list[ProjectFont],
) -> RenderResult:
    """Render a project to PDF.

    Raises:
        RenderError: if the document cannot be laid out at all.
    """
    html_source, font_families = _render_html_document(project, files, assets, fonts)

    content_paths = set(project.content)
    markdown_files = [
        (file.path, file.text) for file in files if file.path in content_paths
    ]
    headings = _collect_headings_in_order(markdown_files)

    captured: list[logging.LogRecord] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            captured.append(record)

    handler = _Capture()
    weasy_logger = logging.getLogger("weasyprint")
    weasy_logger.addHandler(handler)
    previous_level = weasy_logger.level
    weasy_logger.setLevel(logging.WARNING)

    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            try:
                document = HTML(string=html_source, media_type="print").render()
                pdf_bytes = document.write_pdf()
            except Exception as exc:
                raise RenderError(str(exc)) from exc

        render_warnings = collect_warnings(
            WarningContext(
                project=project,
                files=files,
                assets=assets,
                font_families=font_families,
                pdf_bytes=pdf_bytes,
                headings=headings,
                log_messages=[record.getMessage() for record in captured],
            )
        )
        render_warnings.extend(
            analyze_layout(document, {title: path for _, title, path in headings})
        )
        for entry in caught:
            render_warnings.append(
                RenderWarning(code="python.warning", message=str(entry.message))
            )
    finally:
        weasy_logger.removeHandler(handler)
        weasy_logger.setLevel(previous_level)

    outline = _extract_outline(pdf_bytes, headings)
    return RenderResult(pdf=pdf_bytes, outline=outline, warnings=render_warnings)
