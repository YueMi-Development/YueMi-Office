"""The contract the service and the app share, as a fixture.

Two things have to be the same on both sides:

- The differences the service produces. The app applies them, so the two
  have to agree about what a change means.
- The names of the assistant's tools. The app sends them to the model
  provider, so a tool that is called by one name on one side and another on
  the other would never be found.

The fixture is written by the service's own code and read by the app's test,
so a difference between the two shows up as a failing test rather than as a
document that comes out wrong.

The app's copy of this file lives at
`packages/protocol/src/fixtures/assistant.json`.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ai.diff import diff_hunks  # noqa: E402
from app.ai.tools import TOOLS  # noqa: E402

#: Where the fixture is written. The path is relative to the repository root.
FIXTURE_PATH = (
    Path(__file__).resolve().parents[3]
    / "packages"
    / "protocol"
    / "src"
    / "fixtures"
    / "assistant.json"
)

#: The pairs of texts the fixture holds.
CASES: list[tuple[str, str]] = [
    (
        "one\ntwo\nthree\n",
        "one\nTWO\nthree\n",
    ),
    (
        "# Title\n\nFirst paragraph.\n\nSecond paragraph.\n",
        "# Title\n\nFirst paragraph, edited.\n\nSecond paragraph.\n",
    ),
    (
        "one\ntwo\nthree\nfour\nfive\n",
        "one\ntwo\nthree\nfour\nfive\n",
    ),
    (
        "",
        "# A new file\n\nWith a paragraph.\n",
    ),
]


def build_fixture() -> dict:
    """The fixture's contents, made by the service's own code."""
    cases = []

    for old_text, new_text in CASES:
        hunks = diff_hunks(old_text, new_text)
        cases.append(
            {
                "oldText": old_text,
                "newText": new_text,
                "hunks": [
                    {
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
                    for hunk in hunks
                ],
            }
        )

    return {
        "cases": cases,
        "tools": list(TOOLS.keys()),
    }


def write_fixture() -> Path:
    """Write the fixture and return where it went."""
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(
        json.dumps(build_fixture(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return FIXTURE_PATH


if __name__ == "__main__":
    path = write_fixture()
    print(f"wrote {path}")
