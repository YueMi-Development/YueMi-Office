#!/usr/bin/env bash
#
# Read the version out of a tag.
#
#     version-from-tag.sh v1.0.0
#
# The version and whether it names a pre-release are written to
# GITHUB_OUTPUT, so the step can use them.
#
# The tag is passed in as an argument rather than read from the
# environment, because a tag is not a safe thing to paste into a shell,
# and the argument is quoted wherever it is used.

set -euo pipefail

tag="${1:-}"

if [[ ! "$tag" =~ ^v([0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?)$ ]]; then
  echo "::error::The tag $tag does not name a version. A tag is a v and three numbers, an optional pre-release identifier and optional build metadata: v1.0.0, v1.0.0-beta."
  exit 1
fi

version="${BASH_REMATCH[1]}"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "version=$version" >> "$GITHUB_OUTPUT"

  # A tag with a dash in it names a pre-release, and GitHub shows those
  # as pre-releases rather than as finished releases.
  if [[ "$version" == *-* ]]; then
    echo "prerelease=true" >> "$GITHUB_OUTPUT"
  else
    echo "prerelease=false" >> "$GITHUB_OUTPUT"
  fi
fi

echo "$version"
