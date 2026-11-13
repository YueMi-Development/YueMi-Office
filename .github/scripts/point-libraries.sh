#!/usr/bin/env bash
#
# Point the loader at the libraries WeasyPrint loads through CFFI.
#
#     point-libraries.sh windows /path/to/msys2
#     point-libraries.sh macos
#
# WeasyPrint loads Pango through CFFI, which needs to be told where the
# libraries are on the platforms that do not have a standard search path
# for them.
#
# The path is an argument rather than read from the environment, so the
# script says where the libraries have to be rather than assuming that
# something else put them there.

set -euo pipefail

system="${1:-}"

case "$system" in
  windows)
    # The msys2 action prints where its toolchain is, and the Pango
    # libraries live in the ucrt64 folder inside it.
    location="${2:-}"
    if [ -z "$location" ]; then
      echo "The location of the msys2 toolchain is needed." >&2
      exit 2
    fi
    echo "WEASYPRINT_DLL_DIRECTORIES=${location}\\ucrt64\\bin" >> "$GITHUB_ENV"
    ;;
  macos)
    # Homebrew installs into a folder that is not on the loader's path
    # when it runs on Apple silicon.
    echo "DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib:/usr/local/lib" >> "$GITHUB_ENV"
    ;;
  *)
    echo "The system is needed: windows or macos." >&2
    exit 2
    ;;
esac
