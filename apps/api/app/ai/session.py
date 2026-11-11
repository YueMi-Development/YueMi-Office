"""Running a session of tool calls against a document.

A session is a list of tool calls and the answers to them, plus the changes
the assistant proposed along the way. The changes are not applied here: the
user sees them and decides, which is what the assistant is required to do
(PRD section 7).

The session runs against the project that travelled with the request. The
service is stateless, so the assistant cannot reach anything the user did not
send.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.ai.tools import ToolContext, run_tool
from app.models import (
    Project,
    ProjectAsset,
    ProjectFile,
    ProjectFont,
)


@dataclass(frozen=True)
class ToolCall:
    """One tool call, as the assistant asks for it."""

    id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ToolCallResult:
    """What a tool call produced."""

    id: str
    name: str
    arguments: dict[str, Any]
    ok: bool
    result: dict[str, Any] | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "arguments": self.arguments,
            "ok": self.ok,
            "result": self.result,
            "error": self.error,
        }


def run_session(
    project: Project,
    files: list[ProjectFile],
    assets: list[ProjectAsset],
    fonts: list[ProjectFont],
    calls: list[ToolCall],
) -> dict[str, Any]:
    """Run the calls of a session and collect what they produced.

    A call that fails does not stop the session: the answer is recorded with
    the reason, so the assistant can try something else.
    """
    context = ToolContext(project, files, assets, fonts)
    results: list[ToolCallResult] = []

    for call in calls:
        ok, result, error = run_tool(context, call.name, call.arguments)
        results.append(
            ToolCallResult(
                id=call.id,
                name=call.name,
                arguments=dict(call.arguments or {}),
                ok=ok,
                result=result,
                error=error,
            )
        )

    return {
        "id": "session-1",
        "calls": [result.to_dict() for result in results],
        "edits": list(context.edits),
    }
