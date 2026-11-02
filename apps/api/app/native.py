"""WeasyPrint's native library configuration.

WeasyPrint needs Pango, Cairo and Fontconfig through CFFI. On Linux these
come from the system packages; on Windows they have to be pointed at
explicitly, before `weasyprint` is imported anywhere else.

Set `WEASYPRINT_DLL_DIRECTORIES` to a `;`-separated list of directories that
contain the GTK/Pango runtime DLLs. The GTK3-Runtime installer puts them in
`C:\\Program Files\\GTK3-Runtime Win64\\bin`, which is WeasyPrint's own
default. This module adds that default plus anything the environment names,
so importing this module is enough to make WeasyPrint importable.
"""

from __future__ import annotations

import os
import sys

#: Directories searched for the Pango/Cairo runtime, in order.
DEFAULT_DLL_DIRECTORIES = (
    r"C:\Program Files\GTK3-Runtime Win64\bin",
    r"C:\msys64\ucrt64\bin",
    r"C:\msys64\mingw64\bin",
    # Inkscape ships the GTK/Pango runtime alongside its own binaries, which
    # makes it a usable fallback when the GTK3-Runtime is not installed.
    r"G:\Inkscape\bin",
)


def configure_dll_directories() -> list[str]:
    """Register the native library directories with the OS loader.

    Returns:
        The directories that were successfully registered.
    """
    if not hasattr(os, "add_dll_directory"):
        # Not Windows: the loader finds the libraries through the system
        # search path.
        return []

    configured = os.environ.get("WEASYPRINT_DLL_DIRECTORIES")
    if configured:
        candidates = [
            entry.strip()
            for entry in configured.split(";")
            if entry.strip()
        ]
    else:
        candidates = list(DEFAULT_DLL_DIRECTORIES)

    registered: list[str] = []
    for directory in candidates:
        if not os.path.isdir(directory):
            continue
        try:
            os.add_dll_directory(directory)
        except (OSError, FileNotFoundError):
            continue
        registered.append(directory)

    if registered:
        # WeasyPrint reads this variable when it is imported, so make the
        # directories it registers discoverable by name as well.
        existing = os.environ.get("WEASYPRINT_DLL_DIRECTORIES", "")
        merged = ";".join(
            dict.fromkeys(
                [entry for entry in existing.split(";") if entry] + registered
            )
        )
        os.environ["WEASYPRINT_DLL_DIRECTORIES"] = merged

    return registered


if not hasattr(sys, "frozen"):
    configure_dll_directories()
