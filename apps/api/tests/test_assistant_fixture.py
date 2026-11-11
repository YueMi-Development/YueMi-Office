"""The contract the service and the app share, as a fixture.

Two things have to be the same on both sides:

- The differences the service produces. The app applies them, so the two
  have to agree about what a change means.
- The names of the assistant's tools. A tool called by one name on one side
  and another on the other would never be found.

The fixture is written by the service's own code and read by the app's test,
so a difference between the two shows up as a failing test rather than as a
document that comes out wrong.

The app's copy of this file lives at
`packages/protocol/src/fixtures/assistant.json`.
"""

from __future__ import annotations

import json

from scripts.write_assistant_fixture import FIXTURE_PATH, build_fixture


class TestAssistantFixture:
    def test_the_fixture_is_up_to_date(self):
        """The committed fixture matches what the service produces now.

        When this fails, the fixture has to be written again with
        `python scripts/write_assistant_fixture.py`.
        """
        assert FIXTURE_PATH.exists(), (
            "The assistant fixture is missing. Write it with "
            "`python scripts/write_assistant_fixture.py`."
        )

        committed = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        expected = build_fixture()

        assert committed == expected, (
            "The assistant fixture is out of date. Write it again with "
            "`python scripts/write_assistant_fixture.py`."
        )

    def test_the_fixture_names_every_tool(self):
        """The fixture lists the tools, so the app can check its own list.

        The app has its own list of tool names, and the fixture is the only
        place the two are compared. A tool added on one side and forgotten
        on the other shows up here rather than as a call that never matches.
        """
        committed = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

        assert committed["tools"] == list(build_fixture()["tools"])
        assert len(committed["tools"]) == len(set(committed["tools"]))
