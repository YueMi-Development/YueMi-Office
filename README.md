# YueMi Office

A desktop app for writing and laying out print-ready documents in
[Typst](https://typst.app). An AI assistant works on the project the way a
coding agent works on a repository: it reads the source, proposes edits as
reviewable diffs, and checks the rendered result.

See [PRD Files](docs/PRD-typst-document-studio.md)
for the full product requirements.

## Why Typst

Typst is a markup language for typesetting, like LaTeX but with the
syntax of a modern one. It replaces Markdown plus CSS, and it is a better
fit for a document studio for three reasons:

- **The layout is part of the document.** Typst has page geometry, headers
  and footers, tables, figures and precise margins built in. CSS in a
  print context is a layer of emulation on top of a browser engine that
  was never asked to lay out pages.
- **The output is the same everywhere.** Typst lays out and rasterises
  with its own engine, so the same document gives the same pages on
  Windows, macOS and Linux. A committed visual baseline is worth
  something.
- **An agent can read it.** The source is a small, regular language with
  explicit functions, so a model can propose a change to it and the change
  can be applied as a diff.

## Running it

You need [Bun](https://bun.sh) and Rust.

```bash
bun install
bun run dev:desktop
```

There is no service to start. The renderer is a Rust library inside the
app: the same code that lays out the document for the preview lays it out
for the export and for the pages the assistant is shown.

## Tests

```bash
bun run test
cd apps/desktop/src-tauri && cargo test
```

The visual check renders a reference document and compares the pages with
the committed baselines:

```bash
.github/scripts/visual-check.sh
```

## Documentation

| Document | What it covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | How the parts fit together, the project format, how the renderer works |
| [docs/assistant.md](docs/assistant.md) | The agent loop, the tools, the providers, the keys, the settings dialog |
| [docs/development.md](docs/development.md) | Running it, building an installer, where the version is declared, what CI and the release workflow do |
| [docs/linting.md](docs/linting.md) | The linters of the two languages, the rules of each one, what the formatters are kept away from, and the hook that runs only the linters a change reaches before a push |
| [docs/PRD-typst-document-studio.md](docs/PRD-typst-document-studio.md) | The product requirements |

## Status

| Milestone | Contents | State |
|---|---|---|
| M1 | Project format, editor, render pipeline, preview, export | Done |
| M2 | Templates, font bundling, render warnings, visual regression tests | Done |
| M3 | AI tool layer, diff UI, snapshots | Done |
| M4 | AI chat, streaming, render feedback loop, providers, settings | Done |
| M5 | Packaging, signing, auto-update | In progress — packaging done, signing and auto-update planned |
