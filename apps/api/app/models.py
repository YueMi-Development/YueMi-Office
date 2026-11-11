"""Pydantic models mirroring the shared protocol contract.

Field names are kept identical to the TypeScript definitions in
`packages/protocol` so both sides can be read side by side.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

PROJECT_SCHEMA_VERSION = 2

PageSize = Literal[
    "A0", "A1", "A2", "A3", "A4", "A5", "Letter", "Legal", "Tabloid"
]
Orientation = Literal["portrait", "landscape"]
PdfVariant = Literal[
    "pdf/a-1b",
    "pdf/a-2b",
    "pdf/a-3b",
    "pdf/a-2u",
    "pdf/a-3u",
    "pdf/ua-1",
]


class PageConfig(BaseModel):
    size: PageSize = "A4"
    orientation: Orientation = "portrait"


class PdfConfig(BaseModel):
    variant: Optional[PdfVariant] = None


class Project(BaseModel):
    """The contents of a project's `project.json`."""

    schemaVersion: int = PROJECT_SCHEMA_VERSION
    title: str = "Untitled"
    language: str = "en"
    content: list[str] = Field(default_factory=list)
    styles: list[str] = Field(default_factory=list)
    fonts: list[str] = Field(default_factory=list)
    assetsDir: str = "assets"
    page: PageConfig = Field(default_factory=PageConfig)
    pdf: PdfConfig = Field(default_factory=PdfConfig)


class ProjectFile(BaseModel):
    """A text file (Markdown content or CSS) within a project."""

    path: str
    text: str = ""


class ProjectAsset(BaseModel):
    """A binary asset within a project, inlined so the service stays stateless."""

    path: str
    base64: str
    mimeType: str = "application/octet-stream"


class ProjectFont(BaseModel):
    """A bundled font file, inlined so the service stays stateless."""

    path: str
    base64: str
    mimeType: str = "font/woff2"
    family: Optional[str] = None


class RenderRequest(BaseModel):
    project: Project
    files: list[ProjectFile] = Field(default_factory=list)
    assets: list[ProjectAsset] = Field(default_factory=list)
    fonts: list[ProjectFont] = Field(default_factory=list)


class RenderWarning(BaseModel):
    code: str
    message: str
    path: Optional[str] = None


class OutlineEntry(BaseModel):
    title: str
    level: int
    page: int
    anchor: str
    children: list[int] = Field(default_factory=list)


class RenderOutline(BaseModel):
    entries: list[OutlineEntry] = Field(default_factory=list)
    pageCount: int = 0


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    weasyprintVersion: str
    pythonVersion: str


class AiToolCall(BaseModel):
    """One tool call, as the assistant asks for it."""

    id: str = ""
    name: str
    arguments: dict = Field(default_factory=dict)


class AiSessionRequest(BaseModel):
    """A request to run a session of tool calls against a project."""

    project: Project
    files: list[ProjectFile] = Field(default_factory=list)
    assets: list[ProjectAsset] = Field(default_factory=list)
    fonts: list[ProjectFont] = Field(default_factory=list)
    calls: list[AiToolCall] = Field(default_factory=list)


class AiToolResult(BaseModel):
    """What a tool call produced."""

    id: str
    name: str
    arguments: dict = Field(default_factory=dict)
    ok: bool = True
    result: Optional[dict] = None
    error: Optional[str] = None


class DiffChangeModel(BaseModel):
    """One replacement inside a file."""

    oldStart: int
    oldCount: int
    newLines: list[str] = Field(default_factory=list)


class DiffLineModel(BaseModel):
    """One line of a difference."""

    kind: Literal["context", "added", "removed"]
    text: str
    oldLine: Optional[int] = None
    newLine: Optional[int] = None


class DiffHunkModel(BaseModel):
    """A run of changes shown together, with the lines around them."""

    oldStart: int
    oldCount: int
    newStart: int
    newCount: int
    lines: list[DiffLineModel] = Field(default_factory=list)
    changes: list[DiffChangeModel] = Field(default_factory=list)


class ProposedEditModel(BaseModel):
    """A change the assistant proposes to make to one file."""

    id: str
    path: str
    kind: Literal["replace", "create"]
    oldText: str
    newText: str
    hunks: list[DiffHunkModel] = Field(default_factory=list)


class AiSessionResponse(BaseModel):
    """The result of a session: what each call did, and what it proposed."""

    id: str
    calls: list[AiToolResult] = Field(default_factory=list)
    edits: list[ProposedEditModel] = Field(default_factory=list)


class AiToolDescriptionModel(BaseModel):
    """A tool the assistant can call, with the schema of its arguments."""

    name: str
    description: str
    parameters: dict = Field(default_factory=dict)
