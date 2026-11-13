#!/usr/bin/env bash
#
# Build the render service image and run the tests inside it.
#
#     backend-tests.sh
#
# The tests run inside the render image, because the visual baselines
# were produced by exactly that stack: the same Debian release, the same
# Pango, the same WeasyPrint. Running them against the runner's own
# libraries would compare the baselines with a slightly different engine,
# which is a difference in the environment rather than in the code.
#
# The build context is the repository root, so the script is run from
# there too.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

docker build -f apps/api/Dockerfile --target test -t yuemi-api:test .
docker run --rm yuemi-api:test
