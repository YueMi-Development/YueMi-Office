"""The whole path the assistant's changes travel.

A session is run against the service, the changes it proposes are applied the
way the app applies them, and the document that comes out is checked. This is
the path a scripted edit takes end to end (PRD section 10, milestone 3).
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.ai.diff import apply_changes

CONTENT = (
    "# Getting Started\n"
    "\n"
    "The opening paragraph.\n"
    "\n"
    "## Installation\n"
    "\n"
    "Run the installer.\n"
)


def make_request(calls: list[dict]) -> dict:
    """A session request over a small project."""
    return {
        "project": {
            "schemaVersion": 2,
            "title": "Scripted Edit",
            "language": "en",
            "content": ["content/intro.md"],
            "styles": ["styles/main.css"],
            "fonts": [],
            "assetsDir": "assets",
            "page": {"size": "A4", "orientation": "portrait"},
            "pdf": {"variant": None},
        },
        "files": [
            {"path": "content/intro.md", "text": CONTENT},
            {"path": "styles/main.css", "text": "body {\n  font-size: 11pt;\n}\n"},
        ],
        "assets": [],
        "fonts": [],
        "calls": calls,
    }


def run_session(client: TestClient, calls: list[dict]) -> dict:
    """Run a session and return its result."""
    response = client.post("/v1/ai/session", json=make_request(calls))
    assert response.status_code == 200
    return response.json()


class TestScriptedEdit:
    def test_a_scripted_edit_changes_the_document(self, client: TestClient):
        session = run_session(
            client,
            [
                {
                    "id": "1",
                    "name": "propose_edit",
                    "arguments": {
                        "path": "content/intro.md",
                        "newText": CONTENT.replace(
                            "The opening paragraph.", "A rewritten opening."
                        ),
                    },
                }
            ],
        )

        assert len(session["edits"]) == 1
        edit = session["edits"][0]

        changes = [change for hunk in edit["hunks"] for change in hunk["changes"]]
        result = apply_changes(edit["oldText"], changes)

        assert "A rewritten opening." in result
        assert "The opening paragraph." not in result

    def test_the_unchanged_parts_of_the_file_survive(self, client: TestClient):
        session = run_session(
            client,
            [
                {
                    "id": "1",
                    "name": "propose_edit",
                    "arguments": {
                        "path": "content/intro.md",
                        "newText": CONTENT.replace(
                            "The opening paragraph.", "A rewritten opening."
                        ),
                    },
                }
            ],
        )

        edit = session["edits"][0]
        changes = [change for hunk in edit["hunks"] for change in hunk["changes"]]
        result = apply_changes(edit["oldText"], changes)

        assert result.startswith("# Getting Started\n")
        assert "## Installation" in result
        assert "Run the installer." in result

    def test_a_style_change_leaves_the_markdown_alone(self, client: TestClient):
        session = run_session(
            client,
            [
                {
                    "id": "1",
                    "name": "set_style",
                    "arguments": {
                        "selector": "body",
                        "declarations": {"font-size": "12pt"},
                    },
                }
            ],
        )

        edit = session["edits"][0]
        assert edit["path"] == "styles/main.css"
        assert "font-size: 12pt;" in edit["newText"]
        assert "font-size: 11pt;" not in edit["newText"]

    def test_the_tools_read_the_document_before_it_is_changed(self, client: TestClient):
        session = run_session(
            client,
            [
                {"id": "1", "name": "list_sections", "arguments": {}},
                {
                    "id": "2",
                    "name": "read_section",
                    "arguments": {
                        "path": "content/intro.md",
                        "heading": "Installation",
                    },
                },
            ],
        )

        sections = session["calls"][0]["result"]["sections"]
        assert [section["title"] for section in sections] == [
            "Getting Started",
            "Installation",
        ]
        assert "Run the installer." in session["calls"][1]["result"]["text"]

    def test_a_change_is_not_applied_until_the_user_accepts_it(
        self, client: TestClient
    ):
        """The session proposes; it does not write.

        The service never touches the user's files, so the only thing a
        session can do is describe a change.
        """
        session = run_session(
            client,
            [
                {
                    "id": "1",
                    "name": "propose_edit",
                    "arguments": {
                        "path": "content/intro.md",
                        "newText": "# Something else entirely\n",
                    },
                }
            ],
        )

        edit = session["edits"][0]
        assert edit["oldText"] == CONTENT
        assert edit["newText"] != CONTENT

    def test_a_render_reports_what_the_document_looks_like(self, client: TestClient):
        session = run_session(
            client,
            [{"id": "1", "name": "render_preview", "arguments": {}}],
        )

        result = session["calls"][0]["result"]
        assert result["pageCount"] >= 1
        assert isinstance(result["warnings"], list)
