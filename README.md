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

## The assistant

The assistant is a loop rather than a single question. It sends the
conversation to the provider, runs the tools the model asks for, sends the
results back, and goes round again until the model answers without asking
for anything. A change that affects the layout is rendered and the pages
are shown to the model, so it can see what it did rather than only being
told.

The model never writes a file. Every change goes through `propose_edit` or
`set_style` and reaches the document only after the user accepts it.

Six tools are on offer: `list_sections`, `read_section`, `search`,
`propose_edit`, `set_style` and `render_preview`.

### Providers and keys

Three wire formats are supported: Anthropic's Messages API, OpenAI's Chat
Completions API, and any other server that speaks the second one — Ollama,
LM Studio, OpenRouter, vLLM. A custom provider is added in the settings
dialog by giving it an address and a format.

The keys live in the user's home folder, under `~/.yuemi-office/`:

```
~/.yuemi-office/
├── config.json       the providers, the active model, the settings
└── credentials.json  the API keys, one per provider
```

They are kept apart because `config.json` is the file a user would paste
into an issue, and a key in it would be a leak. The key never travels back
to the webview either: the app asks the shell to set a key and is told only
whether one is there.

Both files are written by writing a temporary file next to them and moving
it into place, so an interrupted write leaves the old file whole instead of
a half-written one that cannot be read.

The settings dialog has one **Save** button, and it saves everything on it:
the address of the render service, the providers, the provider that is
active, the model, and whether the assistant is allowed to run. A key has its
own button next to the field it is pasted into, and saving a key does not
touch the rest of the form. Removing a provider and saving clears the key
that belonged to it.

The setting that turns the assistant off is honoured by the shell as well
as by the window, so a run cannot be started from outside the app when the
document's contents are not meant to leave the machine.

Each provider has its own **Test provider** button. The button tries the
provider as the form shows it, not as it was last saved, so a new provider or
a changed address can be tried before the settings are kept. The answer is
shown under the provider it belongs to, and a failure says why: a missing
address, a missing key, a key the provider refused, or a provider that did
not answer within thirty seconds. A key that has only been typed is used as
it is, so the provider can be tried before the key is saved.

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

## Building a binary

The installers for the platform you are on are built with one command:

```bash
bun run build:desktop
```

It prints what the platform needs before it starts, then runs `tauri build`. The
output lands in `apps/desktop/src-tauri/target/release/bundle`:

| Platform | Files |
|---|---|
| Windows | `yuemi_<version>_x64_en-US.msi`, `yuemi_<version>_x64-setup.exe` |
| macOS | `yuemi_<version>_aarch64.dmg`, `yuemi.app.tar.gz` |
| Linux | `yuemi_<version>_amd64.deb`, `yuemi-<version>-1.x86_64.rpm`, `yuemi_<version>_amd64.AppImage` |

The version in the file names comes from `apps/desktop/src-tauri/tauri.conf.json`.
`bun run set-version 1.0.0-beta` puts a different one there and in the other
files that carry it.

The builds are not signed. Windows and macOS will warn about an application
from an unknown developer.

## Tests

```bash
cd apps/api && pytest                    # 144 tests
bun run test                             # 209 tests
cd apps/desktop/src-tauri && cargo test  # 100 tests
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

The visual job asks for bash on purpose. A runner on Windows runs a step in
PowerShell by default, and PowerShell does not read a trailing backslash as a
line continuation, so a command spread over several lines that way never
parses there. A test checks that rule for the whole workflow file, because
nothing else in the suite looks at it.

## Releases

A release is built from a tag, and only from a tag. Pushing a tag that names
a version — `v1.0.0` or `v1.0.0-beta` — runs
[.github/workflows/release.yml](.github/workflows/release.yml), which builds
the installers for Windows, macOS and Linux and attaches them to a GitHub
Release. A tag with a dash in it is published as a pre-release.

The tag's version is written into the tree before the build, so the
installers, the packages and the release page all carry the same number.
See [Building a binary](#building-a-binary) for what the installers are
called.

## Status

| Milestone | Contents | State |
|---|---|---|
| M1 | Project format, editor, render pipeline, preview, export | Done |
| M2 | Templates, font bundling, render warnings, visual regression tests | Done |
| M3 | AI tool layer, diff UI, snapshots | Done |
| M4 | AI chat, streaming, render feedback loop, providers, settings | Done |
| M5 | Packaging, signing, auto-update | In progress — packaging done, signing and auto-update planned |
