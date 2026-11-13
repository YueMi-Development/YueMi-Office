#!/usr/bin/env sh
#
# Lint the Rust side of the repository.
#
#     lint-rust.sh
#
# Clippy is the linter and rustfmt is the formatter, and both come with the
# Rust toolchain, so nothing has to be installed for them.
#
# The warnings are errors. A linter whose findings can be ignored is a
# linter that is read once and then ignored.
#
# The script is run from the root of the repository, because the icons are
# written from the root and the Rust side reads them into the binary.
#
# The body is written in POSIX shell, so the hook that runs it before a
# push can call it with `sh` on every platform. The hook runner is the same
# everywhere, and a script that needs a shell that is not always there
# fails on the machine of the person who pushes rather than on a runner.

set -eu

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

# The icons are not in the repository. They are derived from one picture,
# and the Rust side reads the icon of the window into the binary, so a
# compile without them fails.
bun run scripts/generate-icons.ts

cd apps/desktop/src-tauri

echo "== rustfmt"
cargo fmt --check

echo "== Clippy"
cargo clippy --all-targets -- -D warnings
