#!/usr/bin/env bash
#
# Put the right version inside a Debian package.
#
#     fix-deb-version.sh <the .deb> <the version the package carries>
#
# The Tauri bundler writes the version of the app into the control file
# of the package, and the version of the app is a plain semver version.
# Debian cannot take a pre-release identifier in that field: `1.0.0-beta`
# is read as the upstream version `1.0.0` with the revision `beta`, and
# a revision sorts after no revision at all, so the finished release
# looks older than the pre-release and apt will not upgrade to it.
#
# The version Debian wants for a pre-release is `1.0.0~beta`, where the
# tilde says that the revision sorts before the finished release. The
# package is unpacked, the control file is rewritten, and the package is
# packed again.
#
# The name of the file is not changed. The name is what a person reads,
# and it is the readable one.

set -euo pipefail

deb="${1:-}"
version="${2:-}"

if [ -z "$deb" ] || [ -z "$version" ]; then
  echo "The package and the version are needed." >&2
  echo "Use it like this: fix-deb-version.sh yuemi_1.0.0-beta_amd64.deb 1.0.0~beta" >&2
  exit 2
fi

if [ ! -f "$deb" ]; then
  echo "There is no package at $deb." >&2
  exit 1
fi

if ! command -v dpkg-deb > /dev/null 2>&1; then
  echo "dpkg-deb is not on this machine, so the package cannot be rewritten." >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

dpkg-deb -R "$deb" "$work/root"

control="$work/root/DEBIAN/control"

if [ ! -f "$control" ]; then
  echo "The package has no control file, so there is no version to rewrite." >&2
  exit 1
fi

if ! grep -q '^Version:' "$control"; then
  echo "The control file has no version, so there is nothing to rewrite." >&2
  exit 1
fi

# The version is put into the file with a substitution rather than
# written into the file by hand, so that a version with a character the
# shell would read cannot change the command.
sed -i "s/^Version:.*/Version: $version/" "$control"

# The package is owned by root on a machine where the build runs as
# another user, and the ownership of the files inside it is part of
# what the package says.
dpkg-deb --root-owner-group --build "$work/root" "$work/fixed.deb"

mv "$work/fixed.deb" "$deb"

echo "The package $deb now carries the version $version."
