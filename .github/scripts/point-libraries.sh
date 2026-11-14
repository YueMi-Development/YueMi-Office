#!/usr/bin/env bash
#
# Point the loader at the libraries WeasyPrint loads through CFFI.
#
#     point-libraries.sh windows
#     point-libraries.sh macos
#
# WeasyPrint loads Pango through CFFI, which needs to be told where the
# libraries are on the platforms that do not have a standard search path
# for them.
#
# The location of the toolchain is read from the environment, because a
# path with backslashes pasted into a command line is read by the shell
# first, and the shell strips the backslashes out of it before the script
# ever sees it. A path given as an argument overrides the environment, so
# the script can still be called by hand.

set -euo pipefail

system="${1:-}"

# The file the runner reads the environment of the later steps from. A
# script called by hand has no runner, so the values go to the output
# instead of into a file that is not there.
env_file="${GITHUB_ENV:-/dev/stdout}"

# The GTK3 runtime is on the list WeasyPrint keeps by itself. Naming the
# variable replaces that list rather than adding to it, so the runtime is
# named here as well, or a run that relies on it stops finding it.
gtk_runtime='C:\Program Files\GTK3-Runtime Win64\bin'

case "$system" in
  windows)
    # The msys2 action prints where its toolchain is, and the Pango
    # libraries live in the ucrt64 folder inside it.
    location="${2:-${MSYS2_LOCATION:-}}"
    if [ -z "$location" ]; then
      echo "The location of the msys2 toolchain is needed." >&2
      exit 2
    fi

    # A trailing backslash would give a doubled separator below.
    while [ "${location: -1}" = '\' ]; do
      location="${location%?}"
    done

    libraries="$(printf '%s\\ucrt64\\bin' "$location")"

    # The loader is told about a directory that has to hold the library it
    # loads. A wrong path fails much later with a message about a missing
    # library and no mention of the path, so the directory is looked at
    # here and the path is named when it is wrong.
    #
    # The location is looked for as it was given and as a path with
    # slashes, because a path with backslashes in it names one folder on
    # a system that keeps the backslashes and a path of folders on one
    # that does not.
    folder=''
    for candidate in "$location/ucrt64/bin" "$(printf '%s' "$location" | tr '\\' '/')/ucrt64/bin"; do
      if [ -d "$candidate" ]; then
        folder="$candidate"
        break
      fi
    done

    if [ -z "$folder" ]; then
      echo "There is no folder at ${libraries}." >&2
      exit 1
    fi
    if ! ls "$folder"/libgobject-2.0-*.dll >/dev/null 2>&1; then
      echo "There is no libgobject-2.0 library in ${libraries}." >&2
      exit 1
    fi

    printf 'WEASYPRINT_DLL_DIRECTORIES=%s;%s\n' "$libraries" "$gtk_runtime" >> "$env_file"
    ;;
  macos)
    # Homebrew installs into a folder that is not on the loader's path
    # when it runs on Apple silicon.
    echo "DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib:/usr/local/lib" >> "$env_file"
    ;;
  *)
    echo "The system is needed: windows or macos." >&2
    exit 2
    ;;
esac
