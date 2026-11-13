# YueMi Office

A desktop app for writing and laying out print-ready documents in Markdown
with CSS. An AI assistant will work on the project the way a coding agent
works on a repository: it reads the source, proposes edits as reviewable
diffs, and checks the rendered result.

This repository is at **M4 (AI chat)**: the project format, the editor, the
render pipeline, the PDF preview, export, templates, bundled fonts, render
warnings, visual regression tests, the assistant's tool layer with a
reviewable diff for every change it proposes, and the chat itself — the
agent loop, the streaming answer, and the rendered pages shown back to the
model after a change that moves the layout.

See [docs/PRD-markdown-document-studio.md](docs/PRD-markdown-document-studio.md)
for the full product requirements.

## Running it

You need [Bun](https://bun.sh), Rust, and Python 3.10+.

```bash
# The render service
cd apps/api
python -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --port 32100

# The desktop app, in another terminal
bun install
bun run dev:desktop
```

The app talks to the render service at `http://127.0.0.1:32100` by default,
and the address can be changed in the app's Settings dialog.

WeasyPrint needs Pango and Cairo. On Linux, install the packages listed in
[the CI workflow](.github/workflows/ci.yml). On Windows, install the GTK3
Runtime, or point `WEASYPRINT_DLL_DIRECTORIES` at a directory that has the
Pango DLLs.

## Tests

```bash
cd apps/api && pytest
bun run test
cd apps/desktop/src-tauri && cargo test
```

## Documentation

| Document | What it covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | How the parts fit together, the project format, the render service's endpoints |
| [docs/assistant.md](docs/assistant.md) | The agent loop, the tools, the providers, the keys, the settings dialog |
| [docs/development.md](docs/development.md) | Running it, building an installer, what CI and the release workflow do |
| [docs/PRD-markdown-document-studio.md](docs/PRD-markdown-document-studio.md) | The product requirements |

## Status

| Milestone | Contents | State |
|---|---|---|
| M1 | Project format, editor, render pipeline, preview, export | Done |
| M2 | Templates, font bundling, render warnings, visual regression tests | Done |
| M3 | AI tool layer, diff UI, snapshots | Done |
| M4 | AI chat, streaming, render feedback loop, providers, settings | Done |
| M5 | Packaging, signing, auto-update | In progress — packaging done, signing and auto-update planned |
