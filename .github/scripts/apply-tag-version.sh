#!/usr/bin/env bash
#
# Put the version a tag names into the tree.
#
#     apply-tag-version.sh v1.0.0
#
# The tag is the version of a build. The script reads the version out of
# the tag with the script that refuses a tag that names no version, and
# writes it into every file that carries one.
#
# The tag is passed in as an argument rather than read from the
# environment, because a tag is not a safe thing to paste into a shell,
# and the argument is quoted wherever it is used.

set -euo pipefail

tag="${1:-}"

if [ -z "$tag" ]; then
  echo "The tag is needed." >&2
  echo "Use it like this: apply-tag-version.sh v1.0.0" >&2
  exit 2
fi

scripts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$scripts_dir/../.." && pwd)"

# The script that reads the tag refuses a tag that names no version, so
# the error is the one that was already written for that case. Its
# message goes to the error stream of the script, which is passed
# through, so that the refusal is seen rather than swallowed.
version="$("$scripts_dir/version-from-tag.sh" "$tag")"

cd "$repository_root"

bun run scripts/set-version.ts "$version"
