# PRD: AI-Assisted Markdown Document Studio

## 1. Overview

A desktop app for writing and laying out print-ready documents in Markdown with CSS. An AI assistant works on the project the way a coding agent works on a repository: it reads the source, proposes edits as reviewable diffs, and checks the rendered result. The PDF preview always matches the exported file.

## 2. Problem

Writing in Word or Google Docs makes exact layout hard to control and hard to version. Plain Markdown is easy to write but has no layout control. Developers who want precise output currently stitch together pandoc, CSS, and scripts by hand, with no assistant to help with either the content or the layout.

## 3. Goals

- Produce print-ready PDFs with precise typography, margins, and positioning.
- Give users an AI assistant that edits content and layout through diffs they can accept or reject.
- Show the same output on Windows, macOS, and Linux.
- Keep documents as plain-text project folders that work with git.

## 4. Non-goals (v1)

- Real-time multi-user collaboration.
- Editing `.docx` files directly (export only, and only as a basic conversion).
- Fully offline AI.
- A WYSIWYG editor. The source is Markdown and CSS.
- Mobile apps.

## 5. Target users

- **Primary:** technical writers, students, and independent authors who need polished PDFs such as reports, resumes, proposals, and handbooks.
- **Secondary:** developers who produce documentation or invoices and want a template-driven workflow.

## 6. Core features (MVP)

**Project and editing**
- Create, open, and save projects as a folder containing `content/*.md`, `styles/*.css`, and `project.json`.
- Editor with Markdown syntax highlighting, outline sidebar, and search across files.
- Live PDF preview with debounced re-rendering and page navigation.
- Snapshot-based undo for the whole project, including AI changes.

**Rendering**
- Markdown to HTML to PDF via the rendering service.
- Page size, margins, headers, footers, and page numbers configurable in CSS.
- Bundled fonts (`.woff2`), no reliance on system fonts.
- Render warnings for overflowing tables, orphaned headings, and missing fonts.

**AI assistant**
- Chat panel that streams responses.
- Tools: list sections, read section, search, propose edit, set style, render preview.
- Inline diff view with accept and reject per hunk.
- Each AI session is grouped as a single undoable action.
- The assistant sees rendered page images after layout changes.

**Export**
- PDF export.
- Markdown export, and `.docx` export as a best-effort conversion with a note about what is lost.

## 7. AI requirements

- The model never edits rendered output, only source files.
- Every write goes through `propose_edit` and requires user approval unless the user turns on auto-accept for a session.
- The model cannot access files outside the project folder or run arbitrary commands.
- Each session shows which files and tools were used.
- Users can choose the model per request (fast for inline rewrites, stronger for layout work).
- Responses stream, with the first token typically under 2 seconds.

## 8. Non-functional requirements

- **Consistency:** the same project produces the same PDF on all three OSes. CI compares rasterized pages against reference images.
- **Performance:** preview updates within 1.5 seconds for a 20-page document. App cold start under 3 seconds.
- **Security:** the API key stays on the server. The app authenticates to the backend with a short-lived session token. Project data is encrypted in transit.
- **Privacy:** document content is sent to the AI provider only when the user uses the assistant. The privacy policy states this clearly, and a setting lets users disable AI features entirely.
- **Reliability:** autosave every 10 seconds. Crash recovery restores unsaved buffers.
- **Accessibility:** keyboard navigation for all core actions. Respect OS font scaling in the UI.

## 9. Success metrics

- Time from blank project to first exported PDF under 10 minutes for new users.
- At least 60% of AI edits accepted (the rest indicate a quality problem).
- Preview-to-export mismatch rate of zero in CI for the reference suite.
- Weekly active projects retained at 30 days.

## 10. Milestones

1. **M1, Foundations (3 weeks):** project format, editor, Markdown to HTML to PDF render, pdf.js preview, export on all three OSes.
2. **M2, Layout tooling (2 weeks):** templates, font bundling, render warnings, CI visual tests.
3. **M3, AI tools without chat (2 weeks):** tool layer, diff UI, snapshots. Test with scripted edits.
4. **M4, AI chat (2 weeks):** agent loop, streaming, render feedback loop with page images.
5. **M5, Beta (2 weeks):** packaging, signing, auto-update, user testing.

## 11. Open questions

- Is the rendering service hosted (simpler, consistent output, requires internet) or bundled as a local sidecar (works offline, needs Python packaging per OS)? This PRD assumes hosted for v1.
- Pricing: free tier with limited AI usage, or BYO API key?
- Should templates be user-created only, or include a built-in library?
- How much `.docx` fidelity is worth supporting?

---

## 12. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Desktop shell | **Tauri 2** | Small installers, native on all three OSes, Rust shell is thin |
| UI framework | **React + TypeScript** (Vite) | Large ecosystem, good editor libraries |
| Editor | **CodeMirror 6** | Built for code and Markdown, extensible, lightweight |
| Diff view | **CodeMirror merge view** or **diff** library | Inline accept/reject per hunk |
| PDF preview | **pdf.js** | Same rendering in every webview |
| Styling in the app | **Tailwind CSS** or **CSS Modules** | Keeps app UI separate from document CSS |
| State | **Zustand** | Simple, works well with streaming updates |
| Markdown parsing | **markdown-it** (frontend preview of structure), **pandoc** or **markdown-it** on the server | Consistent parsing for outline and render |
| Backend language | **Python 3.12 + FastAPI** | Native WeasyPrint support, Anthropic Python SDK, simple async streaming |
| Rendering | **WeasyPrint** | Full paged-media CSS support, page headers and footers, precise margins |
| Document conversion | **pandoc** | Markdown to `.docx` export |
| Agent loop | **Anthropic SDK** with tool use and prompt caching | Vision input for page feedback, cache for stable context |
| Auth | **Short-lived tokens** (JWT) plus OS keychain for refresh tokens | Keeps the API key server-side |
| Project storage | **Local folders**, optional git integration | Portable and version-controllable |
| Testing | **Vitest** (frontend), **pytest** (backend), **tauri-driver** (UI), **pixel diff** on rendered pages (CI) | Covers logic, UI, and cross-platform layout |
| CI/CD | **GitHub Actions** on Windows, macOS, and Linux runners | Builds, tests, and visual regression per OS |
| Hosting | **Docker** container on a VPS or a container platform, behind a reverse proxy | Pins WeasyPrint's system dependencies (Pango, Cairo) |
| Observability | **OpenTelemetry** plus error reporting (e.g., Sentry) | Tracks render failures and AI tool errors |

**Alternative backend:** if you'd rather use TypeScript end to end, use Node or Bun with Hono and the Anthropic TypeScript SDK. You'd then render PDFs with a Python WeasyPrint service or switch to headless Chromium, which reintroduces some rendering differences between platforms unless it runs only on the server.
