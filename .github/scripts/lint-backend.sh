#!/usr/bin/env bash
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

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

docker build -f apps/api/Dockerfile --target lint -t yuemi-api:lint .
docker run --rm yuemi-api:lint
