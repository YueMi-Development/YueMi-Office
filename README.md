# YueMi Office

A desktop app for writing and laying out print-ready documents in Markdown
with CSS. An AI assistant will work on the project the way a coding agent
works on a repository: it reads the source, proposes edits as reviewable
diffs, and checks the rendered result.

This repository is at **M1 (Foundations)**: the project format, the editor,
the render pipeline, the PDF preview, and export. The AI assistant lands in
later milestones.

See [docs/PRD-markdown-document-studio.md](docs/PRD-markdown-document-studio.md)
for the full product requirements.

## How it fits together

```
apps/desktop     Tauri 2 + React + TypeScript desktop app
apps/api         FastAPI render service (Python 3.12 + WeasyPrint)
packages/protocol  Types shared between the app and the service
examples/welcome    A sample project to open and try
```

A document is a plain-text folder that works with git:

```
my-document/
├── project.json     the manifest
├── content/         Markdown files, in document order
├── styles/          CSS files, in cascade order
└── assets/          images and fonts
```

`project.json` lists content and styles as explicit ordered arrays rather
than directory globs, so the same project renders identically on every
operating system.

## The preview is the document

The PDF preview is not an approximation of the export. Both come from the
same render, and the bytes the preview shows are the bytes the export
writes. They cannot drift apart, because there is only one of them.

## Running it

You need [Bun](https://bun.sh), Rust, and Python 3.10+.

**Render service**

```bash
cd apps/api
python -m venv .venv
. .venv/bin/activate            # .venv\Scripts\activate on Windows
pip install -e ".[dev]"
uvicorn app.main:app --port 8000
```

WeasyPrint needs Pango and Cairo. On Linux, install the packages listed in
[the CI workflow](.github/workflows/ci.yml). On Windows, install the GTK3
Runtime, or point `WEASYPRINT_DLL_DIRECTORIES` at a directory that has the
Pango DLLs.

**Desktop app**

```bash
bun install
bun run dev:desktop
```

The app talks to the render service at `http://127.0.0.1:8000` by default.
Change it with `setApiBaseUrl` in `apps/desktop/src/lib/api.ts`.

**With Docker** (Linux and macOS)

```bash
cd apps/api
docker compose up --build
```

## Tests

```bash
cd apps/api && pytest                    # 22 tests
cd apps/desktop && bun run test          # 39 tests
cd apps/desktop/src-tauri && cargo test  # 7 tests
```

## CI

GitHub Actions runs the backend tests, the frontend tests, a Rust test pass,
and a build on Windows, macOS, and Linux. See
[.github/workflows/ci.yml](.github/workflows/ci.yml).

## Status

| Milestone | Contents | State |
|---|---|---|
| M1 | Project format, editor, render pipeline, preview, export | Done |
| M2 | Templates, font bundling, render warnings, visual regression tests | Planned |
| M3 | AI tool layer, diff UI, snapshots | Planned |
| M4 | AI chat, streaming, render feedback loop | Planned |
| M5 | Packaging, signing, auto-update | Planned |
