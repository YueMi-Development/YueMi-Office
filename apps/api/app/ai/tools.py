"""The tools the AI assistant can use on a document.

The assistant never edits a file directly. It reads the document with the
read-only tools and asks for changes with `propose_edit` and `set_style`, and
the user decides whether those changes are applied (PRD section 7).

Every tool works on the project that travelled with the request. The service
is stateless, so a tool cannot reach the user's disk and cannot reach
anything outside the project folder.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

from app.ai.diff import DiffHunk, diff_hunks
from app.models import (
    Project,
    ProjectAsset,
    ProjectFile,
    ProjectFont,
    RenderOutline,
)
from app.render.pipeline import RenderError, render_project

logger = logging.getLogger(__name__)

#: A heading written the CommonMark way, with an optional closing run of
#: hashes.
_ATX_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")

#: A heading written the Setext way: a line underlined with `=` or `-`.
_SETEXT_UNDERLINE = re.compile(r"^[=-]+\s*$")


@dataclass(frozen=True)
class Section:
    """One heading and the text that follows it.

    Attributes:
        path: The file the section is in.
        title: The heading's text.
        level: The heading level, 1 to 6.
        line: The line the heading is on, counting from 1.
        end_line: The last line of the section, counting from 1.
    """

    path: str
    title: str
    level: int
    line: int
    end_line: int


def _split_lines(text: str) -> list[str]:
    return text.split("\n")


def find_sections(path: str, text: str) -> list[Section]:
    """Find the sections of a Markdown file.

    Both ways of writing a heading are understood: the `## Title` form and
    the `Title` underlined with `=` or `-` form.
    """
    lines = _split_lines(text)
    headings: list[tuple[int, int, str]] = []

    for index, line in enumerate(lines):
        atx = _ATX_HEADING.match(line)
        if atx:
            headings.append((index, len(atx.group(1)), atx.group(2).strip()))
            continue
        if index + 1 < len(lines) and _SETEXT_UNDERLINE.match(lines[index + 1].strip()):
            underline = lines[index + 1].strip()
            if underline.startswith("="):
                level = 1
            elif underline.startswith("-"):
                level = 2
            else:
                continue
            title = line.strip()
            if title:
                headings.append((index, level, title))

    sections: list[Section] = []
    for position, (line_index, level, title) in enumerate(headings):
        # A section ends where the next heading of the same or a higher level
        # begins, because that heading starts a new section.
        end = len(lines)
        for next_index, next_level, _next_title in headings[position + 1 :]:
            if next_level <= level:
                end = next_index
                break
        sections.append(
            Section(
                path=path,
                title=title,
                level=level,
                line=line_index + 1,
                end_line=end,
            )
        )

    return sections


def _markdown_files(project: Project, files: list[ProjectFile]) -> list[ProjectFile]:
    """The project's content files, in document order."""
    by_path = {file.path: file for file in files}
    ordered = [by_path[path] for path in project.content if path in by_path]
    return ordered


def _all_text_files(files: list[ProjectFile]) -> list[ProjectFile]:
    """Every text file the request carried."""
    return list(files)


def _find_file(files: list[ProjectFile], path: str) -> ProjectFile | None:
    for file in files:
        if file.path == path:
            return file
    return None


def _tool_arguments(arguments: dict[str, Any]) -> dict[str, Any]:
    """The arguments of a call, with the empty ones filled in."""
    return arguments or {}


def _string_argument(arguments: dict[str, Any], name: str) -> str | None:
    value = arguments.get(name)
    if isinstance(value, str) and value.strip():
        return value
    return None


def _integer_argument(arguments: dict[str, Any], name: str) -> int | None:
    value = arguments.get(name)
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    return None


class ToolError(Exception):
    """Raised when a tool cannot do what it was asked."""


class ToolContext:
    """The project a tool works on."""

    def __init__(
        self,
        project: Project,
        files: list[ProjectFile],
        assets: list[ProjectAsset],
        fonts: list[ProjectFont],
    ) -> None:
        self.project = project
        self.files = files
        self.assets = assets
        self.fonts = fonts
        self.edits: list[dict[str, Any]] = []

    def file_text(self, path: str) -> str:
        """The text of a file, or an empty string when it is not there."""
        found = _find_file(self.files, path)
        return found.text if found else ""

    def propose(
        self,
        path: str,
        old_text: str,
        new_text: str,
        kind: str = "replace",
    ) -> dict[str, Any]:
        """Record a change the assistant proposes to make."""
        hunks = diff_hunks(old_text, new_text)
        edit = {
            "id": f"edit-{len(self.edits) + 1}",
            "path": path,
            "kind": kind,
            "oldText": old_text,
            "newText": new_text,
            "hunks": [_hunk_to_dict(hunk) for hunk in hunks],
        }
        self.edits.append(edit)
        return edit


def _hunk_to_dict(hunk: DiffHunk) -> dict[str, Any]:
    """A hunk in the shape the shared protocol uses."""
    return {
        "oldStart": hunk.old_start,
        "oldCount": hunk.old_count,
        "newStart": hunk.new_start,
        "newCount": hunk.new_count,
        "lines": [
            {
                "kind": line.kind,
                "text": line.text,
                "oldLine": line.old_line,
                "newLine": line.new_line,
            }
            for line in hunk.lines
        ],
        "changes": [
            {
                "oldStart": change.old_start,
                "oldCount": change.old_count,
                "newLines": list(change.new_lines),
            }
            for change in hunk.changes
        ],
    }


def _tool_list_sections(context: ToolContext, arguments: dict[str, Any]) -> dict[str, Any]:
    """List the sections of the document, in document order."""
    path = _string_argument(arguments, "path")
    files = _markdown_files(context.project, context.files)
    if path:
        files = [file for file in files if file.path == path]

    sections: list[dict[str, Any]] = []
    for file in files:
        for section in find_sections(file.path, file.text):
            sections.append(
                {
                    "path": section.path,
                    "title": section.title,
                    "level": section.level,
                    "line": section.line,
                    "endLine": section.end_line,
                }
            )

    return {"sections": sections}


def _tool_read_section(context: ToolContext, arguments: dict[str, Any]) -> dict[str, Any]:
    """Read a section of the document, or a range of lines of a file."""
    path = _string_argument(arguments, "path")
    if not path:
        raise ToolError("A 'path' is needed to read a section.")

    found = _find_file(context.files, path)
    if found is None:
        raise ToolError(f"There is no file at '{path}' in this project.")

    lines = _split_lines(found.text)

    heading = _string_argument(arguments, "heading")
    if heading:
        wanted = heading.lstrip("#").strip().lower()
        for section in find_sections(path, found.text):
            if section.title.strip().lower() == wanted:
                body = "\n".join(lines[section.line - 1 : section.end_line])
                return {
                    "path": path,
                    "title": section.title,
                    "startLine": section.line,
                    "endLine": section.end_line,
                    "text": body,
                }
        raise ToolError(f"There is no section called '{heading}' in '{path}'.")

    start = _integer_argument(arguments, "startLine")
    end = _integer_argument(arguments, "endLine")
    if start is None:
        raise ToolError("A 'heading' or a 'startLine' is needed to read a section.")

    if start < 1:
        start = 1
    if end is None or end < start:
        end = len(lines)

    return {
        "path": path,
        "startLine": start,
        "endLine": min(end, len(lines)),
        "text": "\n".join(lines[start - 1 : end]),
    }


def _tool_search(context: ToolContext, arguments: dict[str, Any]) -> dict[str, Any]:
    """Search the project's text files for a string."""
    query = _string_argument(arguments, "query")
    if not query:
        raise ToolError("A 'query' is needed to search.")

    path = _string_argument(arguments, "path")
    case_sensitive = arguments.get("caseSensitive") is True
    needle = query if case_sensitive else query.lower()

    files = _all_text_files(context.files)
    if path:
        files = [file for file in files if file.path == path]

    matches: list[dict[str, Any]] = []
    for file in files:
        for index, line in enumerate(_split_lines(file.text)):
            haystack = line if case_sensitive else line.lower()
            if needle in haystack:
                matches.append(
                    {
                        "path": file.path,
                        "line": index + 1,
                        "text": line.strip(),
                    }
                )

    return {"query": query, "matches": matches, "count": len(matches)}


def _tool_propose_edit(context: ToolContext, arguments: dict[str, Any]) -> dict[str, Any]:
    """Propose a new version of a file."""
    path = _string_argument(arguments, "path")
    if not path:
        raise ToolError("A 'path' is needed to propose an edit.")

    new_text = arguments.get("newText")
    if not isinstance(new_text, str):
        raise ToolError("The 'newText' of a proposed edit has to be text.")

    old_text = context.file_text(path)
    kind = "create" if not _find_file(context.files, path) else "replace"
    edit = context.propose(path, old_text, new_text, kind)

    return {
        "path": path,
        "kind": kind,
        "hunks": len(edit["hunks"]),
    }


def _find_css_rule(css: str, selector: str) -> tuple[int, int] | None:
    """Find the body of a CSS rule.

    Returns the offsets of the rule's declarations and of its closing brace,
    or None when the rule is not there.

    Rules inside an at-rule are not found: they may be conditional, and
    replacing one of them would change what the rule means.
    """
    for match in re.finditer(r"(^|\})\s*([^{}@]+)\{", css):
        found = match.group(2).strip()
        if found != selector:
            continue

        depth = 1
        index = match.end()
        while index < len(css) and depth > 0:
            if css[index] == "{":
                depth += 1
            elif css[index] == "}":
                depth -= 1
            index += 1

        return match.end(), index - 1

    return None


def _tool_set_style(context: ToolContext, arguments: dict[str, Any]) -> dict[str, Any]:
    """Propose a change to a stylesheet rule."""
    selector = _string_argument(arguments, "selector")
    if not selector:
        raise ToolError("A 'selector' is needed to set a style.")

    declarations = arguments.get("declarations")
    if isinstance(declarations, dict):
        body = "\n".join(
            f"  {name}: {value};" for name, value in declarations.items()
        )
    elif isinstance(declarations, str):
        body = declarations.strip()
    else:
        raise ToolError("The 'declarations' of a style have to be text or an object.")

    path = _string_argument(arguments, "path")
    if not path:
        styles = context.project.styles
        if not styles:
            raise ToolError("This project has no stylesheet to change.")
        path = styles[0]

    old_text = context.file_text(path)
    if not old_text:
        raise ToolError(f"There is no stylesheet at '{path}' in this project.")

    found = _find_css_rule(old_text, selector)
    if found is None:
        # The rule is not there yet, so it is added at the end of the sheet.
        separator = "" if old_text.endswith("\n\n") else ("\n" if old_text.endswith("\n") else "\n\n")
        new_text = f"{old_text}{separator}{selector} {{\n{body}\n}}\n"
    else:
        start, end = found
        # `start` is just after the opening brace and `end` is the closing
        # brace, so the rule's declarations are what lies between them.
        new_text = f"{old_text[:start]}\n{body}\n{old_text[end:]}"

    edit = context.propose(path, old_text, new_text)

    return {
        "path": path,
        "selector": selector,
        "hunks": len(edit["hunks"]),
    }


def _tool_render_preview(context: ToolContext, arguments: dict[str, Any]) -> dict[str, Any]:
    """Render the document and report what the renderer found."""
    try:
        result = render_project(
            context.project, context.files, context.assets, context.fonts
        )
    except RenderError as exc:
        raise ToolError(f"The document could not be rendered: {exc}") from exc

    return {
        "pageCount": result.outline.pageCount,
        "outline": _outline_to_dict(result.outline),
        "warnings": [warning.model_dump() for warning in result.warnings],
    }


def _outline_to_dict(outline: RenderOutline) -> list[dict[str, Any]]:
    return [entry.model_dump() for entry in outline.entries]


#: The tools the assistant can use, each with the schema of its arguments.
TOOLS: dict[str, Any] = {
    "list_sections": {
        "handler": _tool_list_sections,
        "description": (
            "List the headings of the document, in document order, with the file "
            "each one is in and the line it is on."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Limit the list to one file.",
                }
            },
        },
    },
    "read_section": {
        "handler": _tool_read_section,
        "description": (
            "Read a section of the document by its heading, or a range of lines "
            "of a file."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "The file to read."},
                "heading": {
                    "type": "string",
                    "description": "The heading of the section to read.",
                },
                "startLine": {
                    "type": "integer",
                    "description": "The first line to read.",
                },
                "endLine": {
                    "type": "integer",
                    "description": "The last line to read.",
                },
            },
            "required": ["path"],
        },
    },
    "search": {
        "handler": _tool_search,
        "description": "Search the project's text files for a string.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The text to look for."},
                "path": {
                    "type": "string",
                    "description": "Limit the search to one file.",
                },
                "caseSensitive": {
                    "type": "boolean",
                    "description": "Whether the search respects case.",
                },
            },
            "required": ["query"],
        },
    },
    "propose_edit": {
        "handler": _tool_propose_edit,
        "description": (
            "Propose a new version of a file. The user sees the difference and "
            "decides whether to accept it."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "The file to change."},
                "newText": {
                    "type": "string",
                    "description": "The file's new contents.",
                },
            },
            "required": ["path", "newText"],
        },
    },
    "set_style": {
        "handler": _tool_set_style,
        "description": (
            "Propose a change to a CSS rule, either changing an existing rule "
            "or adding one."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "selector": {
                    "type": "string",
                    "description": "The CSS selector to change.",
                },
                "declarations": {
                    "type": "object",
                    "description": "The declarations to set on the rule.",
                },
                "path": {
                    "type": "string",
                    "description": "The stylesheet to change.",
                },
            },
            "required": ["selector", "declarations"],
        },
    },
    "render_preview": {
        "handler": _tool_render_preview,
        "description": (
            "Render the document and report the page count, the outline and any "
            "warnings the renderer found."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
}


def run_tool(
    context: ToolContext,
    name: str,
    arguments: dict[str, Any] | None,
) -> tuple[bool, dict[str, Any] | None, str | None]:
    """Run one tool call.

    Returns whether it succeeded, what it produced and, when it did not, why.
    """
    tool = TOOLS.get(name)
    if tool is None:
        return False, None, f"There is no tool called '{name}'."

    try:
        result = tool["handler"](context, _tool_arguments(arguments or {}))
    except ToolError as exc:
        return False, None, str(exc)
    except Exception as exc:  # pragma: no cover - a tool should not crash the session
        logger.exception("tool failed: %s", name)
        return False, None, f"The tool '{name}' failed: {exc}"

    return True, result, None
