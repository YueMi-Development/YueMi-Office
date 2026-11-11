"""The assistant's side of the application.

The tools live here so that the assistant can only reach a project the user
sent, and so that every change it makes has to be shown to the user before
it is applied (PRD section 7).
"""

from app.ai.session import run_session
from app.ai.tools import TOOLS, ToolContext, find_sections, run_tool

__all__ = [
    "TOOLS",
    "ToolContext",
    "find_sections",
    "run_session",
    "run_tool",
]
