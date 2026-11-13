"""The version of the service, and the places that carry it.

The service is a Python package, so its version is declared in more than
one place: the `pyproject.toml` that the package is built from, the
`__version__` of the package itself, and the version of the FastAPI
application that reports it over the health endpoint. Nothing forces
them to agree, so they are compared here.

The version of a build is decided by the tag that is pushed, and the
workflow writes that version into the tree before the build. The tree
therefore carries a version that is a declaration of intent, and the
places have to agree with each other so that the service never reports
a version that is not the one it was built from.

The desktop app's copy of the version lives in the files of the app, and
the ordinary CI checks that the two halves of the repository agree.
"""

from __future__ import annotations

import re
from pathlib import Path

from app import __version__
from app.main import app

#: The directory of the package, which is where the files below live.
PACKAGE_ROOT = Path(__file__).resolve().parents[1]

#: The manifest the package is built from.
PYPROJECT = PACKAGE_ROOT / "pyproject.toml"


def _pyproject_version() -> str:
    """The version the manifest declares.

    The version is read out of the `[project]` table rather than out of
    the whole file, because the dependencies have versions of their own
    and some of them are pinned exactly.
    """
    contents = PYPROJECT.read_text(encoding="utf-8")
    match = re.search(r"^\[project\]$(.*?)^\[", contents, re.MULTILINE | re.DOTALL)
    assert match, "The pyproject.toml has no [project] table."

    version = re.search(r'^version\s*=\s*"([^"]+)"', match.group(1), re.MULTILINE)
    assert version, "The [project] table has no version."

    return version.group(1)


def _application_version() -> str:
    """The version the FastAPI application declares.

    The application is built with a call rather than with a keyword
    argument only, so the version is looked for inside that call.
    """
    source = (PACKAGE_ROOT / "app" / "main.py").read_text(encoding="utf-8")
    call = re.search(r"FastAPI\((.*?)\n\)", source, re.DOTALL)
    assert call, "The service has no FastAPI application."

    version = re.search(r'version\s*=\s*"([^"]+)"', call.group(1))
    assert version, "The FastAPI application has no version."

    return version.group(1)


class TestServiceVersion:
    def test_the_package_and_the_manifest_say_the_same(self):
        """The package and the manifest it is built from carry one version."""
        assert __version__ == _pyproject_version()

    def test_the_application_reports_the_version_of_the_package(self):
        """The version the health endpoint reports is the package's."""
        assert app.version == __version__

    def test_the_application_and_the_manifest_say_the_same(self):
        """The application and the manifest carry one version."""
        assert _application_version() == _pyproject_version()

    def test_the_version_is_one(self):
        """The version is a version and not a placeholder.

        A version that is not a version means the file was written by
        something that did not check, and the tag's version would then be
        the only real one.
        """
        assert re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", __version__)
