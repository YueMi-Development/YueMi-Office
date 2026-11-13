#!/usr/bin/env sh
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
#
# The body is written in POSIX shell, so the hook that runs it before a
# push can call it with `sh` on every platform. The hook runner is the same
# everywhere, and a script that needs a shell that is not always there
# fails on the machine of the person who pushes rather than on a runner.

set -eu

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

echo "== ESLint"
bunx eslint .

echo "== Prettier"
bunx prettier --check .
