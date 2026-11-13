#!/usr/bin/env bash
#
# Check that the render service image starts and answers.
#
#     smoke-test-service.sh yuemi-api:ci
#
# The port is read from the service's own code, so this cannot test a
# port the service does not listen on.
#
# The image is given as an argument rather than written into the script,
# so the same script checks the image the CI builds and the image a
# developer builds by hand.

set -euo pipefail

image="${1:-yuemi-api:ci}"
name="${2:-yuemi-api}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

port=$(python -c "import sys; sys.path.insert(0, 'apps/api'); from app.service import SERVICE_PORT; print(SERVICE_PORT)")

# The container is removed when the script ends, so that a failed run does
# not leave a container holding the port.
trap 'docker rm -f "$name" > /dev/null 2>&1 || true' EXIT

docker run -d --name "$name" -p "$port:$port" "$image"

for attempt in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$port/v1/health" > /dev/null; then
    echo "Service is up."
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "Service did not become healthy in time."
    docker logs "$name"
    exit 1
  fi
  sleep 2
done

curl -fsS "http://127.0.0.1:$port/v1/health"
echo
