# PRD: AI-Assisted Typst Document Studio

## 1. Overview

A desktop app for writing and laying out print-ready documents in
[Typst](https://typst.app). An AI assistant works on the project the way a
coding agent works on a repository: it reads the source, proposes edits as
reviewable diffs, and checks the rendered result. The PDF preview always
matches the exported file.

## 2. Problem

Writing in Word or Google Docs makes exact layout hard to control and hard
to version. Plain text is easy to write but has no layout control.
Developers who want precise output currently stitch together pandoc, CSS,
and scripts by hand, with no assistant to help with either the content or
the layout.

Markdown with CSS was the first attempt at this, and it does not go far
enough: CSS was written for screens, and a print stylesheet is a layer of
emulation on top of an engine that was never asked to lay out pages. There
are no real page counters, no precise page geometry, and no way to say
"this heading starts a new page and the one before it must not be left
alone at the bottom".

## 3. Goals

- Produce print-ready PDFs with precise typography, margins, and positioning.
- Give users an AI assistant that edits content and layout through diffs they can accept or reject.
- Show the same output on Windows, macOS, and Linux.
- Keep documents as plain-text project folders that work with git.

## 4. Non-goals (v1)

- Real-time multi-user collaboration.
- Editing `.docx` files directly (export only, and only as a basic conversion).
- Fully offline AI.
- A WYSIWYG editor. The source is Typst.
- Mobile apps.

## 5. Target users

- **Primary:** technical writers, students, and independent authors who need polished PDFs such as reports, resumes, proposals, and handbooks.
- **Secondary:** developers who produce documentation or invoices and want a template-driven workflow.

## 6. Core features (MVP)

**Project and editing**
- Create, open, and save projects as a folder containing `content/*.typ`, a
  `theme.typ`, and `project.json`.
- Editor with Typst syntax highlighting, outline sidebar, and search across files.
- Live PDF preview with debounced re-rendering and page navigation.
- Snapshot-based undo for the whole project, including AI changes.

**Rendering**
- Typst compiled to PDF by the renderer inside the app.
- Page size, margins, headers, footers, and page numbers set in the theme.
- Bundled fonts (`.woff2`), no reliance on system fonts.
- Render warnings for missing images, missing fonts, and content files that
  are listed but not there.

**AI assistant**
- Chat panel that streams responses.
- Tools: list sections, read section, search, propose edit, propose style, render preview.
- Inline diff view with accept and reject per hunk.
- Each AI session is grouped as a single undoable action.
- The assistant sees rendered page images after layout changes.

**Export**
- PDF export.
- Typst export, and `.docx` export as a best-effort conversion with a note about what is lost.

## 7. AI requirements

- The model never edits rendered output, only source files.
- Every write goes through `propose_edit` and requires user approval unless the user turns on auto-accept for a session.
- The model cannot access files outside the project folder or run arbitrary commands.
- Each session shows which files and tools were used.
- Users can choose the model per request (fast for inline rewrites, stronger for layout work).
- Responses stream, with the first token typically under 2 seconds.

## 8. Non-functional requirements

- **Consistency:** the same project produces the same PDF on all three OSes. Typst lays out and rasterises with its own engine, so CI compares rasterized pages against reference images.
- **Performance:** preview updates within 1.5 seconds for a 20-page document. App cold start under 3 seconds.
- **Security:** the API key never enters the webview. The Rust shell makes the request that carries it, so the key is not readable by the page that shows the document.
- **Privacy:** document content is sent to the AI provider only when the user uses the assistant. The privacy policy states this clearly, and a setting lets users disable AI features entirely.
- **Reliability:** autosave every 10 seconds. Crash recovery restores unsaved buffers.
- **Accessibility:** keyboard navigation for all core actions. Respect OS font scaling in the UI.

## 9. Success metrics

- Time from blank project to first exported PDF under 10 minutes for new users.
- At least 60% of AI edits accepted (the rest indicate a quality problem).
- Preview-to-export mismatch rate of zero in CI for the reference suite.
- Weekly active projects retained at 30 days.

## 10. Milestones

1. **M1, Foundations (3 weeks):** project format, editor, Typst to PDF render, pdf.js preview, export on all three OSes.
2. **M2, Layout tooling (2 weeks):** templates, font bundling, render warnings, CI visual tests.
3. **M3, AI tools without chat (2 weeks):** tool layer, diff UI, snapshots. Test with scripted edits.
4. **M4, AI chat (2 weeks):** agent loop, streaming, render feedback loop with page images.
5. **M5, Beta (2 weeks):** packaging, signing, auto-update, user testing.

## 11. Open questions

- Pricing: free tier with limited AI usage, or BYO API key?
- Should templates be user-created only, or include a built-in library?
- How much `.docx` fidelity is worth supporting?

---

## 12. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Desktop shell | **Tauri 2** | Small installers, native on all three OSes, Rust shell is thin |
| UI framework | **React + TypeScript** (Vite) | Large ecosystem, good editor libraries |
| Editor | **CodeMirror 6** | Built for code, extensible, lightweight |
| Diff view | **CodeMirror merge view** or **diff** library | Inline accept/reject per hunk |
| PDF preview | **pdf.js** | Same rendering in every webview |
| Styling in the app | **CSS Modules** | Keeps app UI separate from the document's layout |
| State | **Zustand** | Simple, works well with streaming updates |
| Document format | **Typst** | Real page geometry, page counters, figures and tables; one engine that lays out and rasterises everywhere |
| Renderer | **`typst` crates, in Rust** | The renderer is a library inside the app, so there is no service to run and no version of it to keep in step |
| Document conversion | **pandoc** | Typst to `.docx` export |
| Agent loop | **The provider's own streaming API**, with tool use | Vision input for page feedback |
| Keys | **The Rust shell holds them** | The key is never in the webview, so the page that shows the document cannot read it |
| Project storage | **Local folders**, optional git integration | Portable and version-controllable |
| Testing | **Vitest** (frontend), **cargo test** (renderer), **pixel diff** on rendered pages (CI) | Covers logic, UI, and cross-platform layout |
| CI/CD | **GitHub Actions** on Windows, macOS, and Linux runners | Builds, tests, and visual regression per OS |

**What changed from the Markdown plan.** The document format is Typst
rather than Markdown with CSS, and the renderer is a Rust library inside
the app rather than a Python service beside it. A service was dropped
because there is no longer a second language to run: the layout engine and
the assistant's tools both live in the same Rust process, so a request
crosses no network boundary and no port has to be chosen, remembered or
configured. The consequence for the user is that there is one thing to
start rather than two.
