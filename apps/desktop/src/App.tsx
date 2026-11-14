import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FileTree } from './features/files/FileTree';
import { TypstEditor } from './features/editor/TypstEditor';
import { ConfirmDialog } from './features/editor/ConfirmDialog';
import { PageToolbar } from './features/editor/PageToolbar';
import { usePageRemoval } from './features/editor/usePageRemoval';
import { Outline } from './features/outline/Outline';
import { PdfPreview } from './features/preview/PdfPreview';
import { AssistantPanel } from './features/assistant/AssistantPanel';
import { SettingsDialog } from './features/settings/SettingsDialog';
import { TemplatePicker } from './features/templates/TemplatePicker';
import { createProjectFromTemplate } from './features/templates/createFromTemplate';
import type { DocumentTemplate } from './features/templates/templates';
import { WarningsPanel } from './features/warnings/WarningsPanel';
import { useEditorStore } from './state/editorStore';
import { usePreviewStore } from './state/previewStore';
import { useProjectStore } from './state/projectStore';
import { pickNewProjectFolder, pickSavePath } from './lib/dialog';
import { exportFile, joinTypst, openProject } from './lib/files';
import { basename, parseProject } from './lib/project';
import { insertPage, pageIndexAt, splitPages } from './lib/pages';

export function App() {
  const [projectIssues, setProjectIssues] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  // Where the cursor is, and the file it is in. The offset belongs to the
  // file it was measured in, so it is only used while that file is the one
  // that is open.
  const [cursor, setCursor] = useState<{ path: string; offset: number } | null>(null);
  /**
   * A request to put the cursor somewhere.
   *
   * The request is carried out once. The id tells a new request from the
   * same request seen again after a render, so the cursor is not moved away
   * from where the user put it. The path says which file the request is for,
   * so that it is not carried out in another file.
   */
  const [cursorRequest, setCursorRequest] = useState<{
    path: string;
    offset: number;
    id: number;
  } | null>(null);
  const requestCountRef = useRef(0);

  const {
    pendingRemoval,
    requestPageRemoval,
    requestFileRemoval,
    confirmRemoval,
    cancelRemoval,
  } = usePageRemoval();

  const {
    project,
    files,
    dirty,
    rootPath,
    setFileText,
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

  const saveToDisk = useCallback(async () => {
    const state = useProjectStore.getState();
    if (!state.rootPath) {
      return;
    }
    const { saveProject } = await import('./lib/files');
    await saveProject(state.rootPath, state.project, state.files);
    markSaved();
  }, [markSaved]);

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
    // The interval is set up once. It reads the project from the store on
    // every tick, so it does not have to be rebuilt when the project
    // changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeFile = activePath ?? project.content[0] ?? project.theme ?? null;

  useEffect(() => {
    // The file is cleared when it is gone from the project, but a file that
    // is not part of the document order — the theme, say — stays open,
    // because a warning can point at one.
    if (activePath && !(activePath in files)) {
      setActivePath(null);
    }
  }, [activePath, files, setActivePath]);

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

  const handleExportTypst = useCallback(async () => {
    const state = useProjectStore.getState();
    const path = await pickSavePath(`${state.project.title || 'document'}.typ`, [
      { name: 'Typst source', extensions: ['typ'] },
    ]);
    if (!path) {
      return;
    }
    await exportFile(path, joinTypst(state.project, state.files));
  }, []);

  const handleNewProject = useCallback(async (template: DocumentTemplate) => {
    setShowTemplates(false);
    const folder = await pickNewProjectFolder(
      `Create a new ${template.name.toLowerCase()} project`,
    );
    if (!folder) {
      return;
    }

    await createProjectFromTemplate(folder, template);

    const result = await openProject(folder);
    const { project, issues } = parseProject(
      result.project ? JSON.stringify(result.project) : '',
    );
    setProjectIssues(
      issues.length > 0 ? issues.map((issue) => issue.message).join(' ') : null,
    );

    useProjectStore.getState().openProject(
      folder,
      project,
      result.files.map((file) => ({ path: file.path, text: file.text })),
    );
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

  // The pages of the open file. A file is a tab, and a tab holds as many
  // pages as it has page breaks.
  const pages = useMemo(() => splitPages(editorValue), [editorValue]);

  // The page the cursor is on.
  //
  // The offset belongs to the file it was measured in, so it is only used
  // while that file is the one that is open. Opening another file starts at
  // the beginning of it, which is where the editor puts the cursor.
  const cursorOffset = cursor && cursor.path === activeFile ? cursor.offset : 0;
  const cursorPage = useMemo(
    () => pageIndexAt(pages, cursorOffset),
    [pages, cursorOffset],
  );

  const handleCursorChange = useCallback(
    (offset: number) => {
      if (!activeFile) {
        return;
      }
      setCursor({ path: activeFile, offset });
    },
    [activeFile],
  );

  // The theme is not part of the document, so it has no pages to add to or
  // take away.
  const canEditPages = activeFile !== null && activeFile !== project.theme;

  const handleAddPage = useCallback(() => {
    if (!activeFile || !canEditPages) {
      return;
    }

    const text = useProjectStore.getState().files[activeFile] ?? '';
    const insertion = insertPage(text, cursorOffset);
    setFileText(activeFile, insertion.text);
    // The break is one action, so it is committed as one undo step rather
    // than as part of whatever burst of typing comes next.
    commit();
    // The cursor is put on the page that was just made, so the writer can
    // go straight on with it.
    requestCountRef.current += 1;
    setCursorRequest({
      path: activeFile,
      offset: insertion.offset,
      id: requestCountRef.current,
    });
  }, [activeFile, canEditPages, commit, cursorOffset, setFileText]);

  const handleRemovePageRequest = useCallback(() => {
    if (!activeFile || !canEditPages) {
      return;
    }

    requestPageRemoval(activeFile, cursorPage);
  }, [activeFile, canEditPages, cursorPage, requestPageRemoval]);

  const handleRemoveFileRequest = useCallback(
    (path: string) => {
      requestFileRemoval(path);
    },
    [requestFileRemoval],
  );

  const handleOpenWarningFile = useCallback(
    (path: string) => {
      setActivePath(path);
    },
    [setActivePath],
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
          <button type="button" onClick={() => setShowTemplates(true)}>
            New
          </button>
          <button
            type="button"
            onClick={() => {
              void handleOpen();
            }}
          >
            Open
          </button>
          <button type="button" onClick={undo} disabled={undoStack.length === 0}>
            Undo
          </button>
          <button type="button" onClick={redo} disabled={redoStack.length === 0}>
            Redo
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSave();
            }}
            disabled={!rootPath}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              void handleExportPdf();
            }}
            disabled={!pdf}
          >
            Export PDF
          </button>
          <button
            type="button"
            onClick={() => {
              void handleExportTypst();
            }}
          >
            Export Typst
          </button>
          <button type="button" onClick={() => setShowSettings(true)}>
            Settings
          </button>
          <button type="button" onClick={() => setShowAssistant((shown) => !shown)}>
            Assistant
          </button>
        </div>
      </header>

      {projectIssues && (
        <div className="app-issues" role="alert">
          {projectIssues}
        </div>
      )}

      <main className={`app-body${showAssistant ? ' has-assistant' : ''}`}>
        <aside className="app-sidebar">
          <section className="sidebar-section">
            <h2 className="sidebar-heading">Files</h2>
            <FileTree
              content={project.content}
              theme={project.theme}
              activePath={activeFile}
              onSelect={setActivePath}
              onRemove={handleRemoveFileRequest}
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
            <>
              <PageToolbar
                fileName={basename(activeFile)}
                pageIndex={cursorPage}
                pageCount={pages.length}
                canEdit={canEditPages}
                onAddPage={handleAddPage}
                onRemovePage={handleRemovePageRequest}
              />
              <TypstEditor
                value={editorValue}
                onChange={handleTextChange}
                onCommit={commit}
                onCursorChange={handleCursorChange}
                cursorRequest={
                  cursorRequest && cursorRequest.path === activeFile
                    ? cursorRequest
                    : null
                }
              />
            </>
          ) : (
            <div className="editor-placeholder">
              <p>No file is open.</p>
              <p className="editor-placeholder-hint">
                Add a Typst file to the project to start writing.
              </p>
            </div>
          )}
        </section>

        <section className="app-preview">
          <PdfPreview pdf={pdf} status={status} error={error} />
          <WarningsPanel warnings={warnings} onOpenFile={handleOpenWarningFile} />
        </section>

        {showAssistant && <AssistantPanel onClose={() => setShowAssistant(false)} />}
      </main>

      {showTemplates && (
        <TemplatePicker
          onPick={(template) => {
            void handleNewProject(template);
          }}
          onCancel={() => setShowTemplates(false)}
        />
      )}

      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}

      {pendingRemoval?.kind === 'page' && (
        <ConfirmDialog
          title="Remove page"
          message={`The page ${
            pendingRemoval.index + 1
          } of ${basename(pendingRemoval.path)}${
            pendingRemoval.title ? ` (${pendingRemoval.title})` : ''
          } will be taken out of the file. The change can be undone.`}
          confirmLabel="Remove page"
          onConfirm={confirmRemoval}
          onCancel={cancelRemoval}
        />
      )}

      {pendingRemoval?.kind === 'file' && (
        <ConfirmDialog
          title="Remove file"
          message={`The file ${basename(
            pendingRemoval.path,
          )} will be taken out of the document. The change can be undone.`}
          confirmLabel="Remove file"
          onConfirm={confirmRemoval}
          onCancel={cancelRemoval}
        />
      )}
    </div>
  );
}
