#!/usr/bin/env bash
#
# Install Pango, the layout engine WeasyPrint is built on.
#
#     install-pango.sh linux
#     install-pango.sh macos
#
# The two systems install it in different ways, and the difference is not
# something a workflow should carry. Windows installs it through the
# msys2 action instead, because that action sets up the toolchain as
# well as the library.

set -euo pipefail

system="${1:-}"

case "$system" in
  linux)
    sudo apt-get update
    sudo apt-get install -y --no-install-recommends \
      libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b \
      libharfbuzz-subset0 libcairo2 libgdk-pixbuf-2.0-0 libffi8 \
      shared-mime-info
    ;;
  macos)
    brew install pango || brew upgrade pango
    ;;
  *)
    echo "The system is needed: linux or macos." >&2
    exit 2
    ;;
esac
