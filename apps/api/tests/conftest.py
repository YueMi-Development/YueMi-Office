"""Shared fixtures for the render service tests."""

from __future__ import annotations

import base64

import pytest
from fastapi.testclient import TestClient

from app.main import app

SAMPLE_CSS = """
@page {
  margin: 20mm;
}

body {
  font-family: serif;
  font-size: 11pt;
}

h1 {
  font-size: 24pt;
  page-break-after: avoid;
}
"""

SAMPLE_CONTENT = """# Getting Started

This is the opening section of the document.

## Installation

Install the package and then run it.

## Usage

Run the command from your terminal.
"""


@pytest.fixture()
def client() -> TestClient:
    """A test client for the render API."""
    return TestClient(app)


@pytest.fixture()
def sample_request() -> dict:
    """A minimal but complete render request."""
    return {
        "project": {
            "schemaVersion": 2,
            "title": "Sample Document",
            "language": "en",
            "content": ["content/intro.md"],
            "styles": ["styles/main.css"],
            "fonts": [],
            "assetsDir": "assets",
            "page": {"size": "A4", "orientation": "portrait"},
            "pdf": {"variant": None},
        },
        "files": [
            {"path": "content/intro.md", "text": SAMPLE_CONTENT},
            {"path": "styles/main.css", "text": SAMPLE_CSS},
        ],
        "assets": [],
        "fonts": [],
    }


@pytest.fixture()
def sample_asset() -> dict:
    """A small SVG asset, inlined the way the desktop app sends it."""
    svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'
    return {
        "path": "assets/logo.svg",
        "base64": base64.b64encode(svg.encode("utf-8")).decode("ascii"),
        "mimeType": "image/svg+xml",
    }
