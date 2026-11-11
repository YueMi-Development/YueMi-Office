"""Line differences between two versions of a file.

The assistant proposes changes as a new version of a file. The user sees the
difference between the old and the new version and can accept or reject it
piece by piece, so the difference has to be described in a way that can be
turned back into a file.

A change is therefore recorded as the lines it removes and the lines it puts
in their place, counted from the start of the file. Applying the changes to
the old text gives the new text, which is what makes accepting one hunk of a
change possible without accepting the rest of it.

Lines keep their line endings, so a file can be put back together exactly as
it was. That matters for a document: a missing final newline is a difference
between two platforms' editors and should not show up as a change.
"""

from __future__ import annotations

import difflib
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class DiffChange:
    """One replacement within a file.

    Attributes:
        old_start: The first line the change touches, counting from 1.
        old_count: How many lines the change removes.
        new_lines: The lines the change puts in their place.
    """

    old_start: int
    old_count: int
    new_lines: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class DiffLine:
    """One line of a difference."""

    kind: str
    text: str
    old_line: int | None = None
    new_line: int | None = None


@dataclass(frozen=True)
class DiffHunk:
    """A run of changes shown together, with the lines around them.

    Attributes:
        old_start: The first line of the hunk in the file before the change.
        old_count: How many lines of the original file the hunk covers.
        new_start: The first line of the hunk in the file after the change.
        new_count: How many lines of the changed file the hunk covers.
        lines: The lines of the hunk, each marked as context, added or removed.
        changes: The changes the hunk holds, which are what accepting it applies.
    """

    old_start: int
    old_count: int
    new_start: int
    new_count: int
    lines: list[DiffLine] = field(default_factory=list)
    changes: list[DiffChange] = field(default_factory=list)


def split_lines(text: str) -> list[str]:
    """Split text into the lines a difference is counted in.

    Each line keeps the newline that ends it, so joining the lines back
    together gives the text unchanged. A file that does not end with a
    newline simply has a last line without one, and an empty file has no
    lines at all.

    Only a line feed ends a line. Python's own `splitlines` would also end a
    line on a few other characters, which would make the app and the
    service count the lines of the same file differently.
    """
    if not text:
        return []

    parts = text.split("\n")
    lines = [part + "\n" for part in parts[:-1]]
    if parts[-1]:
        lines.append(parts[-1])
    return lines


def _display(line: str) -> str:
    """The text of a line as it is shown to the user.

    The newline that ends the line is left out, because the difference is
    shown one line per row.
    """
    return line.rstrip("\r\n")


def _as_change(value: Any) -> DiffChange:
    """A change, whether it was given as a dataclass or as plain data.

    Both the Python field names and the names the shared protocol uses are
    accepted, so a change can travel between the two without a translation
    step.
    """
    if isinstance(value, DiffChange):
        return value

    def pick(snake: str, camel: str) -> Any:
        if snake in value:
            return value[snake]
        return value[camel]

    return DiffChange(
        old_start=int(pick("old_start", "oldStart")),
        old_count=int(pick("old_count", "oldCount")),
        new_lines=list(value.get("new_lines") or value.get("newLines") or []),
    )


def _build_hunk(
    opcodes: list[tuple[str, int, int, int, int]],
    first_op: int,
    last_op: int,
    old_lines: list[str],
    new_lines: list[str],
    context: int,
) -> DiffHunk:
    """Build the hunk that covers the given opcodes."""
    lines: list[DiffLine] = []
    changes: list[DiffChange] = []

    lead_op = opcodes[first_op - 1] if first_op > 0 else None
    trail_op = opcodes[last_op + 1] if last_op + 1 < len(opcodes) else None

    # The lines before the change and after it, so the user can see where in
    # the file the change sits.
    if lead_op is not None and lead_op[0] == "equal":
        start = max(lead_op[1], lead_op[2] - context)
        for index in range(start, lead_op[2]):
            lines.append(
                DiffLine(
                    kind="context",
                    text=_display(old_lines[index]),
                    old_line=index + 1,
                    new_line=lead_op[3] + (index - lead_op[1]) + 1,
                )
            )

    for op_index in range(first_op, last_op + 1):
        tag, i1, i2, j1, j2 = opcodes[op_index]

        if tag == "equal":
            for index in range(i1, i2):
                lines.append(
                    DiffLine(
                        kind="context",
                        text=_display(old_lines[index]),
                        old_line=index + 1,
                        new_line=j1 + (index - i1) + 1,
                    )
                )
        elif tag == "delete":
            for index in range(i1, i2):
                lines.append(
                    DiffLine(
                        kind="removed",
                        text=_display(old_lines[index]),
                        old_line=index + 1,
                    )
                )
            changes.append(
                DiffChange(old_start=i1 + 1, old_count=i2 - i1, new_lines=[])
            )
        elif tag == "insert":
            for index in range(j1, j2):
                lines.append(
                    DiffLine(
                        kind="added",
                        text=_display(new_lines[index]),
                        new_line=index + 1,
                    )
                )
            changes.append(
                DiffChange(
                    old_start=i1 + 1,
                    old_count=0,
                    new_lines=list(new_lines[j1:j2]),
                )
            )
        else:
            for index in range(i1, i2):
                lines.append(
                    DiffLine(
                        kind="removed",
                        text=_display(old_lines[index]),
                        old_line=index + 1,
                    )
                )
            for index in range(j1, j2):
                lines.append(
                    DiffLine(
                        kind="added",
                        text=_display(new_lines[index]),
                        new_line=index + 1,
                    )
                )
            changes.append(
                DiffChange(
                    old_start=i1 + 1,
                    old_count=i2 - i1,
                    new_lines=list(new_lines[j1:j2]),
                )
            )

    if trail_op is not None and trail_op[0] == "equal":
        for index in range(trail_op[1], min(trail_op[2], trail_op[1] + context)):
            lines.append(
                DiffLine(
                    kind="context",
                    text=_display(old_lines[index]),
                    old_line=index + 1,
                    new_line=trail_op[3] + (index - trail_op[1]) + 1,
                )
            )

    if lead_op is not None:
        old_start = lead_op[1] + 1
        new_start = lead_op[3] + 1
    else:
        old_start = opcodes[first_op][1] + 1
        new_start = opcodes[first_op][3] + 1

    old_count = sum(1 for line in lines if line.kind in ("context", "removed"))
    new_count = sum(1 for line in lines if line.kind in ("context", "added"))

    return DiffHunk(
        old_start=old_start,
        old_count=old_count,
        new_start=new_start,
        new_count=new_count,
        lines=lines,
        changes=changes,
    )


def diff_hunks(old_text: str, new_text: str, context: int = 3) -> list[DiffHunk]:
    """Find the differences between two versions of a file.

    Changes that are close together are shown in one hunk, so a paragraph
    that was edited in two places does not produce two separate blocks.

    Args:
        old_text: The file's contents before the change.
        new_text: The file's contents after the change.
        context: How many lines to show around each change.
    """
    old_lines = split_lines(old_text)
    new_lines = split_lines(new_text)

    matcher = difflib.SequenceMatcher(None, old_lines, new_lines, autojunk=False)
    opcodes = matcher.get_opcodes()

    change_positions = [
        index for index, (tag, *_rest) in enumerate(opcodes) if tag != "equal"
    ]
    if not change_positions:
        return []

    groups: list[list[int]] = []
    current = [change_positions[0]]
    for position in change_positions[1:]:
        # The opcodes alternate, so the one between two changes is the run of
        # lines that stayed the same.
        gap = opcodes[position - 1]
        if gap[2] - gap[1] <= 2 * context:
            current.append(position)
        else:
            groups.append(current)
            current = [position]
    groups.append(current)

    return [
        _build_hunk(opcodes, group[0], group[-1], old_lines, new_lines, context)
        for group in groups
    ]


def apply_changes(old_text: str, changes: list[Any]) -> str:
    """Put the given changes into a file and return the result.

    Changes that overlap are skipped rather than applied twice, so passing
    the changes of a hunk twice does not corrupt the file.
    """
    lines = split_lines(old_text)
    result: list[str] = []
    cursor = 0

    for raw in sorted((_as_change(change) for change in changes), key=lambda item: item.old_start):
        start = min(max(raw.old_start - 1, 0), len(lines))
        if start < cursor:
            continue
        result.extend(lines[cursor:start])
        result.extend(raw.new_lines)
        cursor = start + raw.old_count

    result.extend(lines[cursor:])
    return "".join(result)
