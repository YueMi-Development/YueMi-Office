#!/usr/bin/env sh
#
# Compare the rendered pages with the baselines.
#
#     visual-check.sh
#     visual-check.sh write
#
# The pages are compared, not the PDF bytes. The bytes carry the metadata
# of the machine that wrote them, while the rendered pages are the same
# document everywhere.
#
# Typst rasterises with its own renderer rather than with the system's, so
# the pages of the same document are the same on every operating system.
# That is what makes a committed baseline worth having.
#
# The word `write` replaces the baselines with the pages that were just
# rendered. It is used when the change to the document is intended, and
# the new baselines are read before they are committed.
#
# The body is written in POSIX shell, so the hook that runs it before a
# push can call it with `sh` on every platform.

set -eu

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

mode="${1:-check}"

# The icons are not in the repository. They are derived from one picture,
# and the Rust side reads the icon of the window into the binary, so a
# compile without them fails.
bun run scripts/generate-icons.ts

cd apps/desktop/src-tauri

echo "== Rendering the reference document"
cargo run --quiet --example visual_check -- "$mode"
