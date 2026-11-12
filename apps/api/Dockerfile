# The render service image. It is the deployed artifact for v1, so it pins the
# same WeasyPrint version the visual baselines were generated with.
#
# The system libraries WeasyPrint needs (Pango, Cairo, HarfBuzz and
# fontconfig) come from Debian rather than the upstream image, because the
# upstream image is several WeasyPrint versions behind and cannot be pinned
# to the version the baselines were made with.
#
# The build context is the repository root, not this folder, because the
# visual tests render the reference project and the templates that live
# outside apps/api:
#
#   docker build -f apps/api/Dockerfile --target runtime -t yuemi-api .
#   docker build -f apps/api/Dockerfile --target test -t yuemi-api:test .
#
# The image has two targets:
#
#   runtime — the service itself.
#   test    — the same service plus the tools the visual tests need. The
#             visual tests run inside this image on every operating system,
#             so the pages they compare were produced by one pinned stack
#             rather than by whatever the runner happened to have.
FROM debian:trixie-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PATH=/opt/venv/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 \
      libpangoft2-1.0-0 \
      libharfbuzz0b \
      libharfbuzz-subset0 \
      libcairo2 \
      libgdk-pixbuf-2.0-0 \
      libffi8 \
      shared-mime-info \
      python3 \
      python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv

# The repository layout is kept intact below the work directory, because the
# tests find the reference project and the templates by walking up from their
# own location.
WORKDIR /repo/apps/api

FROM base AS runtime

COPY apps/api/pyproject.toml ./
COPY apps/api/app ./app

RUN pip install --no-cache-dir .

# The port is read from the service's own code, so the image cannot end up
# listening on a different port from the one the app expects.
EXPOSE 32100

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port $(python -c 'from app.service import SERVICE_PORT; print(SERVICE_PORT)')"]

FROM base AS test

COPY apps/api/pyproject.toml ./
COPY apps/api/app ./app
COPY apps/api/tests ./tests
COPY apps/api/scripts ./scripts

# The templates and the fonts the app ships, which the template tests
# render.
COPY apps/desktop/src/features/templates /repo/apps/desktop/src/features/templates
COPY apps/desktop/public/fonts /repo/apps/desktop/public/fonts

# The contract the service and the app share. The test that keeps the
# fixture up to date reads it from here, and the test that checks the two
# sides agree about the service's port reads the contract itself.
COPY packages/protocol/src /repo/packages/protocol/src

# The dev extra brings in the rasterizer the visual tests compare with.
RUN pip install --no-cache-dir ".[dev]"

CMD ["python", "-m", "pytest", "-v"]
