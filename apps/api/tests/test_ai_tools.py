"""Tests for the assistant's tools and the differences they produce."""

from __future__ import annotations

from app.ai.diff import apply_changes, diff_hunks
from app.ai.session import ToolCall, run_session
from app.ai.tools import ToolContext, find_sections, run_tool
from app.models import Project, ProjectFile


def make_context(files: list[ProjectFile] | None = None) -> ToolContext:
    """A tool context over a small project."""
    project = Project(
        title="Tool Test",
        content=["content/intro.md"],
        styles=["styles/main.css"],
    )
    defaults = [
        ProjectFile(
            path="content/intro.md",
            text=(
                "# Getting Started\n"
                "\n"
                "The opening paragraph.\n"
                "\n"
                "## Installation\n"
                "\n"
                "Run the installer.\n"
                "\n"
                "## Usage\n"
                "\n"
                "Run the command.\n"
            ),
        ),
        ProjectFile(
            path="styles/main.css",
            text="body {\n  font-size: 11pt;\n}\n",
        ),
    ]
    return ToolContext(project, files if files is not None else defaults, [], [])


class TestFindSections:
    def test_finds_atx_headings(self):
        sections = find_sections("content/a.md", "# One\n\ntext\n\n## Two\n")

        assert [section.title for section in sections] == ["One", "Two"]
        assert sections[0].level == 1
        assert sections[1].level == 2

    def test_finds_setext_headings(self):
        sections = find_sections("content/a.md", "One\n===\n\ntext\n\nTwo\n---\n")

        assert [section.title for section in sections] == ["One", "Two"]
        assert sections[0].level == 1
        assert sections[1].level == 2

    def test_a_section_ends_at_the_next_heading_of_the_same_level(self):
        text = "# One\n\nfirst\n\n# Two\n\nsecond\n"

        sections = find_sections("content/a.md", text)

        # The section runs up to the line before the next heading of the same
        # level, which is where the second section starts.
        assert sections[0].end_line == 4
        assert sections[1].line == 5

    def test_a_subheading_belongs_to_its_parent(self):
        text = "# One\n\nintro\n\n## Sub\n\nsub text\n"

        sections = find_sections("content/a.md", text)

        assert sections[0].title == "One"
        assert sections[0].end_line == 8
        assert sections[1].title == "Sub"


class TestListSections:
    def test_lists_the_sections_of_the_document(self):
        context = make_context()

        ok, result, error = run_tool(context, "list_sections", {})

        assert ok, error
        assert result is not None
        titles = [section["title"] for section in result["sections"]]
        assert titles == ["Getting Started", "Installation", "Usage"]

    def test_the_sections_carry_their_file(self):
        context = make_context()

        ok, result, _error = run_tool(context, "list_sections", {})

        assert ok
        assert result is not None
        assert all(
            section["path"] == "content/intro.md" for section in result["sections"]
        )


class TestReadSection:
    def test_reads_a_section_by_its_heading(self):
        context = make_context()

        ok, result, error = run_tool(
            context,
            "read_section",
            {"path": "content/intro.md", "heading": "Installation"},
        )

        assert ok, error
        assert result is not None
        assert "Run the installer." in result["text"]
        assert "Run the command." not in result["text"]

    def test_reads_a_range_of_lines(self):
        context = make_context()

        ok, result, error = run_tool(
            context,
            "read_section",
            {"path": "content/intro.md", "startLine": 1, "endLine": 3},
        )

        assert ok, error
        assert result is not None
        assert result["text"] == "# Getting Started\n\nThe opening paragraph."

    def test_reports_a_missing_file(self):
        context = make_context()

        ok, _result, error = run_tool(
            context, "read_section", {"path": "content/nope.md", "heading": "x"}
        )

        assert not ok
        assert "content/nope.md" in (error or "")

    def test_reports_a_missing_heading(self):
        context = make_context()

        ok, _result, error = run_tool(
            context, "read_section", {"path": "content/intro.md", "heading": "Nope"}
        )

        assert not ok
        assert "Nope" in (error or "")


class TestSearch:
    def test_finds_the_matching_lines(self):
        context = make_context()

        ok, result, error = run_tool(context, "search", {"query": "installer"})

        assert ok, error
        assert result is not None
        assert result["count"] == 1
        assert result["matches"][0]["line"] == 7

    def test_ignores_case_by_default(self):
        context = make_context()

        ok, result, _error = run_tool(context, "search", {"query": "INSTALLER"})

        assert ok
        assert result is not None
        assert result["count"] == 1

    def test_respects_case_when_asked_to(self):
        context = make_context()

        ok, result, _error = run_tool(
            context, "search", {"query": "INSTALLER", "caseSensitive": True}
        )

        assert ok
        assert result is not None
        assert result["count"] == 0

    def test_searches_the_stylesheets_too(self):
        context = make_context()

        ok, result, _error = run_tool(context, "search", {"query": "font-size"})

        assert ok
        assert result is not None
        assert result["matches"][0]["path"] == "styles/main.css"


class TestProposeEdit:
    def test_records_the_change_and_its_difference(self):
        context = make_context()

        ok, result, error = run_tool(
            context,
            "propose_edit",
            {
                "path": "content/intro.md",
                "newText": "# Getting Started\n\nThe opening paragraph.\n",
            },
        )

        assert ok, error
        assert result is not None
        assert result["kind"] == "replace"
        assert len(context.edits) == 1
        assert context.edits[0]["hunks"]

    def test_a_new_file_is_reported_as_created(self):
        context = make_context()

        ok, result, _error = run_tool(
            context,
            "propose_edit",
            {"path": "content/new.md", "newText": "# New\n"},
        )

        assert ok
        assert result is not None
        assert result["kind"] == "create"

    def test_the_change_is_not_applied_to_the_file(self):
        context = make_context()
        before = context.file_text("content/intro.md")

        run_tool(
            context,
            "propose_edit",
            {"path": "content/intro.md", "newText": "# Replaced\n"},
        )

        assert context.file_text("content/intro.md") == before


class TestSetStyle:
    def test_changes_the_body_of_an_existing_rule(self):
        context = make_context()

        ok, result, error = run_tool(
            context,
            "set_style",
            {"selector": "body", "declarations": {"font-size": "12pt"}},
        )

        assert ok, error
        assert result is not None
        new_text = context.edits[0]["newText"]
        assert "font-size: 12pt;" in new_text
        assert "font-size: 11pt;" not in new_text

    def test_adds_a_rule_that_is_not_there_yet(self):
        context = make_context()

        ok, _result, error = run_tool(
            context,
            "set_style",
            {"selector": "h1", "declarations": {"color": "black"}},
        )

        assert ok, error
        new_text = context.edits[0]["newText"]
        assert "h1 {" in new_text
        assert "color: black;" in new_text

    def test_reports_a_missing_selector(self):
        context = make_context()

        ok, _result, error = run_tool(context, "set_style", {"declarations": {}})

        assert not ok
        assert "selector" in (error or "")


class TestRenderPreview:
    def test_reports_the_page_count_and_the_outline(self):
        context = make_context()

        ok, result, error = run_tool(context, "render_preview", {})

        assert ok, error
        assert result is not None
        assert result["pageCount"] >= 1
        assert result["outline"]


class TestUnknownTool:
    def test_reports_a_tool_that_does_not_exist(self):
        context = make_context()

        ok, _result, error = run_tool(context, "delete_everything", {})

        assert not ok
        assert "delete_everything" in (error or "")


class TestRunSession:
    def test_runs_the_calls_in_order(self):
        context = make_context()
        project = context.project
        files = context.files

        result = run_session(
            project,
            files,
            [],
            [],
            [
                ToolCall(id="1", name="list_sections", arguments={}),
                ToolCall(id="2", name="search", arguments={"query": "installer"}),
            ],
        )

        assert [call["name"] for call in result["calls"]] == [
            "list_sections",
            "search",
        ]
        assert all(call["ok"] for call in result["calls"])

    def test_a_failing_call_does_not_stop_the_session(self):
        context = make_context()

        result = run_session(
            context.project,
            context.files,
            [],
            [],
            [
                ToolCall(id="1", name="read_section", arguments={"path": "nope.md"}),
                ToolCall(id="2", name="list_sections", arguments={}),
            ],
        )

        assert result["calls"][0]["ok"] is False
        assert result["calls"][1]["ok"] is True

    def test_collects_the_changes_the_session_proposed(self):
        context = make_context()

        result = run_session(
            context.project,
            context.files,
            [],
            [],
            [
                ToolCall(
                    id="1",
                    name="propose_edit",
                    arguments={"path": "content/intro.md", "newText": "# New\n"},
                )
            ],
        )

        assert len(result["edits"]) == 1
        assert result["edits"][0]["path"] == "content/intro.md"


class TestDiffHunks:
    def test_reports_no_difference_for_equal_texts(self):
        assert diff_hunks("same\n", "same\n") == []

    def test_marks_the_added_and_removed_lines(self):
        hunks = diff_hunks("one\ntwo\n", "one\nthree\n")

        assert len(hunks) == 1
        kinds = [line.kind for line in hunks[0].lines]
        assert "removed" in kinds
        assert "added" in kinds

    def test_keeps_the_lines_around_the_change(self):
        hunks = diff_hunks("a\nb\nc\nd\ne\n", "a\nb\nc\nD\ne\n")

        assert len(hunks) == 1
        assert any(line.kind == "context" and line.text == "a" for line in hunks[0].lines)

    def test_two_changes_far_apart_are_two_hunks(self):
        old = "\n".join(f"line {index}" for index in range(40))
        new = old.replace("line 2", "changed 2").replace("line 35", "changed 35")

        hunks = diff_hunks(old, new)

        assert len(hunks) == 2

    def test_two_changes_close_together_are_one_hunk(self):
        old = "\n".join(f"line {index}" for index in range(20))
        new = old.replace("line 5", "changed 5").replace("line 8", "changed 8")

        hunks = diff_hunks(old, new)

        assert len(hunks) == 1


class TestApplyChanges:
    def test_applies_a_change_to_the_file(self):
        old = "one\ntwo\nthree\n"

        new = apply_changes(old, [{"old_start": 2, "old_count": 1, "new_lines": ["TWO\n"]}])

        assert new == "one\nTWO\nthree\n"

    def test_applies_several_changes(self):
        old = "one\ntwo\nthree\n"

        new = apply_changes(
            old,
            [
                {"old_start": 1, "old_count": 1, "new_lines": ["ONE\n"]},
                {"old_start": 3, "old_count": 1, "new_lines": ["THREE\n"]},
            ],
        )

        assert new == "ONE\ntwo\nTHREE\n"

    def test_adding_lines_keeps_the_rest_of_the_file(self):
        old = "one\ntwo\n"

        new = apply_changes(old, [{"old_start": 2, "old_count": 0, "new_lines": ["new\n"]}])

        assert new == "one\nnew\ntwo\n"

    def test_removing_lines_keeps_the_rest_of_the_file(self):
        old = "one\ntwo\nthree\n"

        new = apply_changes(old, [{"old_start": 2, "old_count": 1, "new_lines": []}])

        assert new == "one\nthree\n"

    def test_the_change_a_hunk_holds_reproduces_the_new_text(self):
        old = "one\ntwo\nthree\nfour\n"
        new = "one\nTWO\nthree\nFOUR\n"

        hunks = diff_hunks(old, new)
        changes = [change for hunk in hunks for change in hunk.changes]

        assert apply_changes(old, changes) == new

    def test_overlapping_changes_are_applied_once(self):
        old = "one\ntwo\nthree\n"

        new = apply_changes(
            old,
            [
                {"old_start": 1, "old_count": 2, "new_lines": ["ONE\n"]},
                {"old_start": 1, "old_count": 2, "new_lines": ["ONE\n"]},
            ],
        )

        assert new == "ONE\nthree\n"

    def test_a_file_without_a_final_newline_keeps_it_that_way(self):
        old = "one\ntwo"

        new = apply_changes(old, [{"old_start": 2, "old_count": 1, "new_lines": ["TWO"]}])

        assert new == "one\nTWO"
