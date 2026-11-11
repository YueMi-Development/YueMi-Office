"""Tests for the assistant's HTTP endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def make_request(calls: list[dict]) -> dict:
    """A session request over a small project."""
    return {
        "project": {
            "schemaVersion": 2,
            "title": "Tool Test",
            "language": "en",
            "content": ["content/intro.md"],
            "styles": ["styles/main.css"],
            "fonts": [],
            "assetsDir": "assets",
            "page": {"size": "A4", "orientation": "portrait"},
            "pdf": {"variant": None},
        },
        "files": [
            {
                "path": "content/intro.md",
                "text": "# Getting Started\n\nThe opening paragraph.\n",
            },
            {"path": "styles/main.css", "text": "body {\n  font-size: 11pt;\n}\n"},
        ],
        "assets": [],
        "fonts": [],
        "calls": calls,
    }


class TestListTools:
    def test_lists_the_tools_the_assistant_can_use(self, client: TestClient):
        response = client.get("/v1/ai/tools")

        assert response.status_code == 200
        names = [tool["name"] for tool in response.json()]
        assert names == [
            "list_sections",
            "read_section",
            "search",
            "propose_edit",
            "set_style",
            "render_preview",
        ]

    def test_every_tool_describes_its_arguments(self, client: TestClient):
        response = client.get("/v1/ai/tools")

        for tool in response.json():
            assert tool["description"]
            assert tool["parameters"]["type"] == "object"


class TestRunSession:
    def test_runs_a_tool_call(self, client: TestClient):
        response = client.post(
            "/v1/ai/session",
            json=make_request([{"id": "1", "name": "list_sections", "arguments": {}}]),
        )

        assert response.status_code == 200
        body = response.json()
        assert body["calls"][0]["ok"] is True
        assert body["calls"][0]["result"]["sections"][0]["title"] == "Getting Started"

    def test_reports_a_call_that_failed(self, client: TestClient):
        response = client.post(
            "/v1/ai/session",
            json=make_request([{"id": "1", "name": "nope", "arguments": {}}]),
        )

        assert response.status_code == 200
        call = response.json()["calls"][0]
        assert call["ok"] is False
        assert call["error"]

    def test_returns_the_changes_the_session_proposed(self, client: TestClient):
        response = client.post(
            "/v1/ai/session",
            json=make_request(
                [
                    {
                        "id": "1",
                        "name": "propose_edit",
                        "arguments": {
                            "path": "content/intro.md",
                            "newText": "# Getting Started\n\nA different paragraph.\n",
                        },
                    }
                ]
            ),
        )

        assert response.status_code == 200
        edits = response.json()["edits"]
        assert len(edits) == 1
        assert edits[0]["path"] == "content/intro.md"
        assert edits[0]["hunks"]

    def test_the_changes_carry_the_lines_around_them(self, client: TestClient):
        response = client.post(
            "/v1/ai/session",
            json=make_request(
                [
                    {
                        "id": "1",
                        "name": "propose_edit",
                        "arguments": {
                            "path": "content/intro.md",
                            "newText": "# Getting Started\n\nAnother paragraph.\n",
                        },
                    }
                ]
            ),
        )

        hunk = response.json()["edits"][0]["hunks"][0]
        kinds = {line["kind"] for line in hunk["lines"]}
        assert "context" in kinds
        assert "added" in kinds
        assert "removed" in kinds
