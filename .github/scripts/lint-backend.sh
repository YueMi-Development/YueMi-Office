#!/usr/bin/env sh
#
# Lint the render service.
#
#     lint-backend.sh
#
# The lint runs inside the render image, because that image is the stack
# the service is deployed on and the one the visual baselines were made
# with. A lint that ran against a different Python would report a
# different set of mistakes than the one that ships.
#
# The rules live in apps/api/pyproject.toml, next to the dependencies they
# apply to, so the tree of the service carries its own rules.
#
# The script is run from the root of the repository, because the build
# context of the image is the repository root.
#
# The body is written in POSIX shell, so the hook that runs it before a
# push can call it with `sh` on every platform. The hook runner is the same
# everywhere, and a script that needs a shell that is not always there
# fails on the machine of the person who pushes rather than on a runner.

set -eu

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

docker build -f apps/api/Dockerfile --target lint -t yuemi-api:lint .
docker run --rm yuemi-api:lint
