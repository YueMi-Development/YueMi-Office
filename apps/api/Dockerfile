# The WeasyPrint base image already carries Pango, Cairo and the fontconfig
# setup that WeasyPrint needs. We layer FastAPI and uvicorn on top.
#
# The upstream image lives on ghcr.io; the Docker Hub repository of the same
# name does not exist.
FROM ghcr.io/weasyprint/weasyprint:58.1

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY pyproject.toml ./
COPY app ./app

RUN pip install --no-cache-dir . fastapi "uvicorn[standard]"

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
