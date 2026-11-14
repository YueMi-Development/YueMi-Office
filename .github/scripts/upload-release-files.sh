#!/usr/bin/env bash
#
# Upload the Linux packages into the release.
#
#     upload-release-files.sh <the tag> <a file or a folder>
#
# The Windows and macOS jobs use the Tauri action, which uploads what it
# builds. The Linux job cannot, because the Debian package has to be
# rewritten before it is uploaded, so the upload is done here.
#
# A file that is already on the release is left alone, so that a re-run
# of a failed workflow does not fail on a file that made it through the
# first time.

set -euo pipefail

tag="${1:-}"
shift

if [ -z "$tag" ] || [ "$#" -eq 0 ]; then
  echo "The tag and at least one file are needed." >&2
  echo "Use it like this: upload-release-files.sh v1.0.0 apps/desktop/src-tauri/target/release/bundle" >&2
  exit 2
fi

if [ -z "${GH_TOKEN:-}" ]; then
  echo "GH_TOKEN is not set, so there is nothing to upload with." >&2
  exit 1
fi

# The repository is named rather than worked out from the folder the
# command runs in, because the release belongs to the repository the
# tag was pushed to and not to whatever the working directory is.
repo="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

existing="$(gh release view "$tag" --repo "$repo" --json assets --jq '.assets[].name')"

for path in "$@"; do
  if [ ! -e "$path" ]; then
    echo "There is nothing at $path." >&2
    exit 1
  fi

  if [ -d "$path" ]; then
    files="$(find "$path" -type f \( -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' \) | sort)"
  else
    files="$path"
  fi

  while IFS= read -r file; do
    [ -n "$file" ] || continue

    name="$(basename "$file")"

    if echo "$existing" | grep -qx "$name"; then
      echo "$name is already on the release, so it is left alone."
      continue
    fi

    gh release upload "$tag" "$file" --repo "$repo" --clobber
    echo "Uploaded $name."
  done <<< "$files"
done
