#!/usr/bin/env bash
#
# Create the release, or find the one that is already there.
#
#     create-release.sh v1.0.0 1.0.0 false
#
# The arguments are the tag, the version and whether the release is a
# pre-release. The id of the release is written to GITHUB_OUTPUT, so the
# three platform jobs can upload into it.
#
# The release is created once, here, and the platform jobs upload into
# it. If each of them created it, they would race each other. The
# release is fetched first when it already exists, so that a re-run of a
# failed workflow adds to it rather than failing.

set -euo pipefail

tag="${1:-}"
version="${2:-}"
prerelease="${3:-false}"

if [ -z "$tag" ] || [ -z "$version" ]; then
  echo "The tag and the version are needed." >&2
  echo "Use it like this: create-release.sh v1.0.0 1.0.0 false" >&2
  exit 2
fi

release_file="$(mktemp)"
trap 'rm -f "$release_file"' EXIT

if gh api "repos/$GITHUB_REPOSITORY/releases/tags/$tag" > "$release_file" 2>/dev/null; then
  echo "The release for $tag already exists."
else
  notes="yuemi $version, built from $tag.

The installers are not signed. macOS and Windows will warn about
an application from an unknown developer."

  if [ "$prerelease" = "true" ]; then
    gh api --method POST "repos/$GITHUB_REPOSITORY/releases" \
      -f tag_name="$tag" \
      -f target_commitish="$GITHUB_SHA" \
      -f name="yuemi $version" \
      -f body="$notes" \
      -F prerelease=true > "$release_file"
  else
    gh api --method POST "repos/$GITHUB_REPOSITORY/releases" \
      -f tag_name="$tag" \
      -f target_commitish="$GITHUB_SHA" \
      -f name="yuemi $version" \
      -f body="$notes" > "$release_file"
  fi
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "release_id=$(jq -r .id "$release_file")" >> "$GITHUB_OUTPUT"
fi
