#!/usr/bin/env bash
#
# Build the Linux packages and put the right version inside them.
#
#     build-linux-packages.sh deb,appimage
#
# The Tauri bundler writes the version of the app into the control file
# of the Debian package, and the version of the app is a plain semver
# version. Debian cannot take a pre-release identifier in that field, so
# the package is rewritten afterwards with the version that Debian reads
# in the right order.
#
# The rpm is not built for a pre-release. Its version has to be set while
# it is built, and the only version the bundler takes is the one in the
# configuration, which has to be plain semver.

set -euo pipefail

bundles="${1:-}"

if [ -z "$bundles" ]; then
  echo "The bundles to build are needed." >&2
  echo "Use it like this: build-linux-packages.sh deb,appimage" >&2
  exit 2
fi

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

bun run build:desktop --bundles "$bundles"

bundle_dir="apps/desktop/src-tauri/target/release/bundle"

deb="$(find "$bundle_dir/deb" -name '*.deb' -type f 2>/dev/null | head -n 1)"

if [ -z "$deb" ]; then
  echo "No Debian package was built." >&2
  exit 1
fi

# The version the package has to carry is the one that sorts before the
# finished release, which is what a pre-release is.
version="$(bun run scripts/package-version.ts)"

.github/scripts/fix-deb-version.sh "$deb" "$version"

echo "The packages are in $bundle_dir."
