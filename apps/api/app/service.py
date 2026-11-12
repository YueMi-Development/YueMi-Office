"""The port the service listens on.

The port is chosen to be out of the way. 8000 is the first port every
Python web framework is taught to use, so it is the first port anything
else on a developer's machine takes, and the service then fails to start
for a reason that has nothing to do with the service.

The port sits in the 32000 band, which is above the ports that software
actually listens on by default and below the range the operating system
hands out to short-lived connections. The upper end of the band is the
important part: Windows and macOS hand out ephemeral ports from 49152
and Linux from 32768, so a service listening there is never handed a
port that is already in use.

The port is also unregistered and unused by the tools a document studio
is developed alongside. That is worth checking rather than assuming:
8123 looks equally free in the IANA registry, but it is the default port
of Home Assistant, which is a de facto standard the registry does not
know about.

The app's copy of this number lives in the shared contract, and the two
are compared by a test, so they cannot drift apart.
"""

from __future__ import annotations

#: The port the service listens on.
SERVICE_PORT = 32100
