#!/usr/bin/env bash
#
# Install the system packages a Linux build needs.
#
#     install-linux-deps.sh libwebkit2gtk-4.1-dev patchelf
#
# The packages are given as arguments rather than written into the script,
# so the job that builds the installers can ask for the extra ones the
# bundler needs without a second script.
#
# The name `fuse` is special: the FUSE library was renamed when Ubuntu
# 24.04 moved to 64-bit time_t, so both names are tried.

set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "The packages are needed." >&2
  echo "Use it like this: install-linux-deps.sh libwebkit2gtk-4.1-dev" >&2
  exit 2
fi

sudo apt-get update

for package in "$@"; do
  if [ "$package" = "fuse" ]; then
    # The build works without the FUSE library, because the tool is asked
    # to extract itself rather than to mount anything, but a runner that
    # has it saves the tool a step.
    sudo apt-get install -y --no-install-recommends libfuse2t64 \
      || sudo apt-get install -y --no-install-recommends libfuse2
  else
    sudo apt-get install -y --no-install-recommends "$package"
  fi
done
