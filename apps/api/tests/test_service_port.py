"""The port the service listens on, and the app's copy of it.

The service, the image that runs it and the app that calls it all have to
agree on the port. Nothing forces them to, so the two numbers are compared
here: a change on one side that is not made on the other shows up as a
failing test rather than as an app that cannot find its service.

The tests also pin down why the port is what it is. A port that is
registered, or one that other software listens on by default, or one in
the range the operating system hands out to short-lived connections, will
be taken away from the service at some point, so those are all refused.

The app's copy lives in the shared contract, in
`packages/protocol/src/index.ts`.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.service import SERVICE_PORT

#: The repository root, found by walking up from this file.
REPO_ROOT = Path(__file__).resolve().parents[3]

#: Where the app's copy of the port lives.
PROTOCOL_SOURCE = REPO_ROOT / "packages" / "protocol" / "src" / "index.ts"

#: The band the port has to sit in.
#
#: It is above the ports software listens on by default and below the range
#: the operating system hands out to short-lived connections.
PORT_BAND = (32000, 32767)

#: The lowest ephemeral port any of the three operating systems hands out.
#
#: Windows and macOS start at 49152 and Linux at 32768, so a service
#: listening below 32768 is never competing with a short-lived connection.
EPHEMERAL_FLOOR = 32768

#: Ports that other software listens on by default.
#:
#: 8000 is the port every Python web framework is taught to use. 8123 is
#: Home Assistant's default web interface. Neither is in the IANA registry
#: in the way a server port usually is, so the registry is not enough to
#: find them.
COMMON_PORTS = (8000, 8123)


def _port_in_protocol() -> int:
    """The port the shared contract names."""
    source = PROTOCOL_SOURCE.read_text(encoding="utf-8")
    match = re.search(r"export const SERVICE_PORT = (\d+);", source)
    assert match, (
        "The shared contract no longer names a service port. The app and the "
        "service have to agree on one."
    )
    return int(match.group(1))


class TestServicePort:
    def test_the_app_and_the_service_use_the_same_port(self):
        """The shared contract and the service name the same port."""
        assert _port_in_protocol() == SERVICE_PORT

    def test_the_port_is_not_one_everything_else_takes(self):
        """The port is not one that is always in use on a developer's machine.

        8000 is the port every Python web framework is taught to use, and
        8123 is the port Home Assistant's web interface uses, so the
        service would fail to start for a reason that has nothing to do
        with the service.
        """
        assert SERVICE_PORT not in COMMON_PORTS

    def test_the_port_is_in_the_registered_range(self):
        """The port is one the operating system will hand out."""
        assert 1024 <= SERVICE_PORT <= 65535

    def test_the_port_is_in_the_band_it_is_meant_to_be_in(self):
        """The port sits above the default ports and below the ephemeral ones."""
        low, high = PORT_BAND

        assert low <= SERVICE_PORT <= high

    def test_the_port_is_below_the_ephemeral_range(self):
        """The operating system does not hand this port to anything else.

        The operating system gives short-lived connections a port out of the
        ephemeral range. A service listening inside that range can be given
        a port that is already in use, or can have its own port taken away
        from under it.
        """
        assert SERVICE_PORT < EPHEMERAL_FLOOR
