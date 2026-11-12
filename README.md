# YueMi Office

A desktop app for writing and laying out print-ready documents in Markdown
with CSS. An AI assistant will work on the project the way a coding agent
works on a repository: it reads the source, proposes edits as reviewable
diffs, and checks the rendered result.

This repository is at **M3 (AI tools without chat)**: the project format, the
editor, the render pipeline, the PDF preview, export, templates, bundled
fonts, render warnings, visual regression tests, and the assistant's tool
layer with a reviewable diff for every change it proposes. The chat
interface lands in M4.

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
├── assets/          images
└── fonts/           font files the document bundles
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
uvicorn app.main:app --port 32100
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

The app talks to the render service at `http://127.0.0.1:32100` by default.
Change the address in the app's Settings dialog. The port is named once in
`packages/protocol/src/index.ts` and once in `apps/api/app/service.py`; a test
keeps the two in step.

**With Docker** (Linux and macOS)

The render service image pins the WeasyPrint version and the system libraries
the visual baselines were produced with:

```bash
cd apps/api
docker compose up --build
```

Or build the image directly:

```bash
docker build -f apps/api/Dockerfile --target runtime -t yuemi-api .
docker run --rm -p 32100:32100 yuemi-api
```

## Tests

```bash
cd apps/api && pytest                    # 124 tests
bun run test                             # 140 tests
cd apps/desktop/src-tauri && cargo test  # 14 tests
```

The visual tests compare the rendered pages of the reference document against
the committed baselines. To regenerate them after a change to the layout
engine that is meant to alter the output:

```bash
cd apps/api && python scripts/render_reference.py --update
```

## CI

GitHub Actions runs the backend tests, the frontend tests, a Rust test pass,
a build on Windows, macOS and Linux, and a visual check that renders the
reference document on all three operating systems and compares the pages.
See [.github/workflows/ci.yml](.github/workflows/ci.yml).

## Status

| Milestone | Contents | State |
|---|---|---|
| M1 | Project format, editor, render pipeline, preview, export | Done |
| M2 | Templates, font bundling, render warnings, visual regression tests | Done |
| M3 | AI tool layer, diff UI, snapshots | Done |
| M4 | AI chat, streaming, render feedback loop | Planned |
| M5 | Packaging, signing, auto-update | Planned |
