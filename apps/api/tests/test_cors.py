"""Tests for the origins the desktop app is allowed to reach the service from.

The app runs in a webview, so the browser's own rules apply to every request
it makes. An origin the service does not allow is turned into a failed
request before the service ever sees it, which looks to the user like the
service is down rather than like a configuration mistake.

So the origins are checked here against the ones Tauri actually uses, which
are listed in tauri's own documentation of its protocol handling.
"""

from __future__ import annotations

import pytest

# The origins the app is served from.
#
# Tauri serves the app over the `tauri://` scheme on macOS and over
# `http://tauri.localhost` or `https://tauri.localhost` elsewhere, and the
# development server serves it over http on port 1420.
APP_ORIGINS = [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://localhost:1420",
    "http://127.0.0.1:1420",
]


@pytest.mark.parametrize("origin", APP_ORIGINS)
def test_the_service_accepts_the_apps_origin(client, origin):
    """A preflight from the app's origin is answered with the origin allowed."""

    response = client.options(
        "/v1/render",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200, response.text
    assert response.headers["access-control-allow-origin"] == origin


@pytest.mark.parametrize("origin", APP_ORIGINS)
def test_the_service_answers_a_render_from_the_apps_origin(
    client, sample_request, origin
):
    """The render itself carries the headers the app needs to read them."""

    response = client.post(
        "/v1/render", json=sample_request, headers={"Origin": origin}
    )

    assert response.status_code == 200, response.text
    assert response.headers["access-control-allow-origin"] == origin
    # The preview reads the outline and the warnings from these headers, so
    # they have to survive the cross-origin check. The warnings header is
    # only sent when there are warnings, so what is checked here is that the
    # browser is told it may read them.
    assert "X-Outline" in response.headers
    exposed = response.headers["access-control-expose-headers"]
    assert "X-Outline" in exposed
    assert "X-Warnings" in exposed
