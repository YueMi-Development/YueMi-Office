"""Pydantic models mirroring the shared protocol contract.

Field names are kept identical to the TypeScript definitions in
`packages/protocol` so both sides can be read side by side.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

PROJECT_SCHEMA_VERSION = 1

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
