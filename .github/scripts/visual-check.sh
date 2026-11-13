#!/usr/bin/env bash
#
# Render the reference document and compare the pages with the baselines.
#
#     visual-check.sh
#
# The pages are compared, not the PDF bytes. The bytes differ between
# operating systems because Pango writes its own metadata into the file,
# while the rendered pages are the same document.
#
# The script is run from the repository root, and the pages are written to
# a folder of their own so that they do not end up in the tree.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pages="$root/apps/api/.tmp-pages"

cd "$root/apps/api"

python scripts/render_pages.py tests/fixtures/reference "$pages"
python scripts/compare_pages.py \
  tests/visual/baseline/reference "$pages" \
  --tolerance 0.002
