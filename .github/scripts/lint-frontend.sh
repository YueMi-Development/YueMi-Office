#!/usr/bin/env bash
#
# Lint the TypeScript side of the repository.
#
#     lint-frontend.sh
#
# ESLint looks for the mistakes that break the program: a promise where a
# void return is expected, a ref that is read while the component renders,
# a state that is set from an effect.
#
# The rules live in eslint.config.mjs at the root of the repository, so
# they cover the desktop app, the shared protocol and the scripts at the
# root in one pass.
#
# The script is run from the root of the repository, because that is where
# the configuration and the lockfile are.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

echo "== ESLint"
bunx eslint .

echo "== Prettier"
bunx prettier --check .
