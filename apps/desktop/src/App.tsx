import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FileTree } from './features/files/FileTree';
import { MarkdownEditor } from './features/editor/MarkdownEditor';
import { Outline } from './features/outline/Outline';
import { PdfPreview } from './features/preview/PdfPreview';
import { useEditorStore } from './state/editorStore';
import { usePreviewStore } from './state/previewStore';
import { useProjectStore } from './state/projectStore';
import { pickSavePath } from './lib/dialog';
import { exportFile, joinMarkdown, openProject } from './lib/files';
import { parseProject } from './lib/project';

export function App() {
  const [projectIssues, setProjectIssues] = useState<string | null>(null);

  const {
    project,
    files,
    dirty,
    rootPath,
    setFileText,
    removeContentFile,
    reorderContent,
    markSaved,
    commit,
    undo,
    redo,
    undoStack,
    redoStack,
  } = useProjectStore();

  const { activePath, setActivePath } = useEditorStore();
  const { status, pdf, outline, pageCount, warnings, error, requestRender } =
    usePreviewStore();

  // Autosave every 10 seconds, as required by PRD section 8.
  const autosaveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    autosaveRef.current = setInterval(() => {
      if (useProjectStore.getState().dirty) {
        void saveToDisk();
      }
    }, 10_000);

    return () => {
      if (autosaveRef.current) {
        clearInterval(autosaveRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeFile = activePath ?? project.content[0] ?? null;

  useEffect(() => {
    if (activePath && !project.content.includes(activePath)) {
      setActivePath(null);
    }
  }, [activePath, project.content, setActivePath]);

  // Re-render whenever the project changes.
  useEffect(() => {
    requestRender();
  }, [project, files, requestRender]);

  const handleTextChange = useCallback(
    (text: string) => {
      if (!activeFile) {
        return;
      }
      setFileText(activeFile, text);
    },
    [activeFile, setFileText],
  );

  const saveToDisk = useCallback(async () => {
    const state = useProjectStore.getState();
    if (!state.rootPath) {
      return;
    }
    const { saveProject } = await import('./lib/files');
    await saveProject(state.rootPath, state.project, state.files);
    markSaved();
  }, [markSaved]);

  const handleExportPdf = useCallback(async () => {
    const state = usePreviewStore.getState();
    if (!state.pdf) {
      return;
    }
    const path = await pickSavePath(`${project.title || 'document'}.pdf`, [
      { name: 'PDF document', extensions: ['pdf'] },
    ]);
    if (!path) {
      return;
    }
    await exportFile(path, state.pdf);
  }, [project.title]);

  const handleExportMarkdown = useCallback(async () => {
    const state = useProjectStore.getState();
    const path = await pickSavePath(`${state.project.title || 'document'}.md`, [
      { name: 'Markdown', extensions: ['md'] },
    ]);
    if (!path) {
      return;
    }
    await exportFile(path, joinMarkdown(state.project, state.files));
  }, []);

  const handleSave = useCallback(async () => {
    const state = useProjectStore.getState();
    if (!state.rootPath) {
      return;
    }
    await saveToDisk();
  }, [saveToDisk]);

  const handleOpen = useCallback(async () => {
    const { pickProjectFolder } = await import('./lib/dialog');
    const folder = await pickProjectFolder();
    if (!folder) {
      return;
    }

    const result = await openProject(folder);
    const { project, issues } = parseProject(
      result.project ? JSON.stringify(result.project) : '',
    );

    if (issues.length > 0) {
      setProjectIssues(issues.map((issue) => issue.message).join(' '));
    } else {
      setProjectIssues(null);
    }

    useProjectStore.getState().openProject(
      folder,
      project,
      result.files.map((file) => ({ path: file.path, text: file.text })),
    );
  }, []);

  const editorValue = useMemo(
    () => (activeFile ? (files[activeFile] ?? '') : ''),
    [activeFile, files],
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <input
            className="app-title-input"
            value={project.title}
            onChange={(event) =>
              useProjectStore.getState().setTitle(event.target.value)
            }
            aria-label="Document title"
          />
          {dirty && <span className="app-dirty" title="Unsaved changes" />}
        </div>

        <div className="app-actions">
          <button type="button" onClick={handleOpen}>
            Open
          </button>
          <button type="button" onClick={undo} disabled={undoStack.length === 0}>
            Undo
          </button>
          <button type="button" onClick={redo} disabled={redoStack.length === 0}>
            Redo
          </button>
          <button type="button" onClick={handleSave} disabled={!rootPath}>
            Save
          </button>
          <button type="button" onClick={handleExportPdf} disabled={!pdf}>
            Export PDF
          </button>
          <button type="button" onClick={handleExportMarkdown}>
            Export Markdown
          </button>
        </div>
      </header>

      {projectIssues && (
        <div className="app-issues" role="alert">
          {projectIssues}
        </div>
      )}

      <main className="app-body">
        <aside className="app-sidebar">
          <section className="sidebar-section">
            <h2 className="sidebar-heading">Files</h2>
            <FileTree
              content={project.content}
              activePath={activeFile}
              onSelect={setActivePath}
              onRemove={removeContentFile}
              onMove={reorderContent}
            />
          </section>

          <section className="sidebar-section sidebar-outline">
            <h2 className="sidebar-heading">Outline</h2>
            <Outline entries={outline} pageCount={pageCount} />
          </section>
        </aside>

        <section className="app-editor">
          {activeFile ? (
            <MarkdownEditor
              value={editorValue}
              onChange={handleTextChange}
              onCommit={commit}
            />
          ) : (
            <div className="editor-placeholder">
              <p>No file is open.</p>
              <p className="editor-placeholder-hint">
                Add a Markdown file to the project to start writing.
              </p>
            </div>
          )}
        </section>

        <section className="app-preview">
          <PdfPreview
            pdf={pdf}
            status={status}
            error={error}
            warnings={warnings}
          />
        </section>
      </main>
    </div>
  );
}
