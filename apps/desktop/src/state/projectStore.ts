import { create } from 'zustand';
import type { Project, ProjectFile } from '@yuemi/protocol';

import { createEmptyProject, normalizePath } from '../lib/project';

/**
 * A snapshot of everything the user can edit.
 *
 * Undo works by restoring whole snapshots rather than by recording
 * individual operations, which keeps undo correct even when several files
 * change together (PRD section 6).
 */
export interface ProjectSnapshot {
  project: Project;
  files: Record<string, string>;
}

export interface ProjectState {
  /** Absolute path of the project folder, or null for an unsaved project. */
  rootPath: string | null;
  project: Project;
  /** File contents keyed by project-relative path. */
  files: Record<string, string>;
  /** Whether the project on disk is older than the buffers. */
  dirty: boolean;
  /** The snapshot stack used for undo. */
  undoStack: ProjectSnapshot[];
  redoStack: ProjectSnapshot[];

  openProject: (rootPath: string, project: Project, files: ProjectFile[]) => void;
  newProject: () => void;
  setProject: (project: Project) => void;
  setFileText: (path: string, text: string) => void;
  /** Ends the current editing burst and makes it undoable. */
  commit: () => void;
  addContentFile: (path: string, text: string) => void;
  removeContentFile: (path: string) => void;
  reorderContent: (from: number, to: number) => void;
  setTitle: (title: string) => void;
  /**
   * Replaces the contents of several files at once.
   *
   * One assistant session is one undoable action, so every file it changed
   * is put back with a single undo step (PRD section 6).
   */
  applyFileEdits: (changes: Record<string, string>) => void;
  markSaved: () => void;
  undo: () => void;
  redo: () => void;
  getFileText: (path: string) => string;
}

/** How many snapshots to keep. */
const MAX_UNDO_DEPTH = 100;

/**
 * The state before the editing burst currently in progress.
 *
 * It is captured when the first keystroke of a burst lands and pushed onto
 * the undo stack when the burst is committed, so one undo step covers one
 * burst rather than one keystroke.
 */
let pendingSnapshot: ProjectSnapshot | null = null;

function snapshotOf(state: {
  project: Project;
  files: Record<string, string>;
}): ProjectSnapshot {
  return {
    project: structuredClone(state.project),
    files: { ...state.files },
  };
}

/**
 * Pushes a snapshot onto the undo stack and drops any redo history.
 */
function pushUndo(
  state: ProjectState,
  snapshot: ProjectSnapshot,
): Pick<ProjectState, 'undoStack' | 'redoStack'> {
  return {
    undoStack: [...state.undoStack, snapshot].slice(-MAX_UNDO_DEPTH),
    redoStack: [],
  };
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  rootPath: null,
  project: createEmptyProject(),
  files: {},
  dirty: false,
  undoStack: [],
  redoStack: [],

  openProject: (rootPath, project, files) => {
    const contents: Record<string, string> = {};
    for (const file of files) {
      contents[normalizePath(file.path)] = file.text;
    }
    pendingSnapshot = null;
    set({
      rootPath,
      project,
      files: contents,
      dirty: false,
      undoStack: [],
      redoStack: [],
    });
  },

  newProject: () => {
    pendingSnapshot = null;
    set({
      rootPath: null,
      project: createEmptyProject(),
      files: {},
      dirty: false,
      undoStack: [],
      redoStack: [],
    });
  },

  setProject: (project) => {
    const state = get();
    pendingSnapshot = null;
    set({
      project,
      dirty: true,
      ...pushUndo(state, snapshotOf(state)),
    });
  },

  setFileText: (path, text) => {
    const state = get();
    const normalized = normalizePath(path);
    if (state.files[normalized] === text) {
      return;
    }
    // Remember the state before this editing burst so it can be restored.
    if (!pendingSnapshot) {
      pendingSnapshot = snapshotOf(state);
    }
    set({
      files: { ...state.files, [normalized]: text },
      dirty: true,
    });
  },

  commit: () => {
    if (!pendingSnapshot) {
      return;
    }
    const state = get();
    const snapshot = pendingSnapshot;
    pendingSnapshot = null;
    set({
      ...pushUndo(state, snapshot),
    });
  },

  addContentFile: (path, text) => {
    const state = get();
    const normalized = normalizePath(path);
    if (state.project.content.includes(normalized)) {
      return;
    }
    pendingSnapshot = null;
    set({
      project: {
        ...state.project,
        content: [...state.project.content, normalized],
      },
      files: { ...state.files, [normalized]: text },
      dirty: true,
      ...pushUndo(state, snapshotOf(state)),
    });
  },

  removeContentFile: (path) => {
    const state = get();
    const normalized = normalizePath(path);
    if (!state.project.content.includes(normalized)) {
      return;
    }
    const files = { ...state.files };
    delete files[normalized];
    pendingSnapshot = null;
    set({
      project: {
        ...state.project,
        content: state.project.content.filter((entry) => entry !== normalized),
      },
      files,
      dirty: true,
      ...pushUndo(state, snapshotOf(state)),
    });
  },

  reorderContent: (from, to) => {
    const state = get();
    const content = [...state.project.content];
    if (
      from < 0 ||
      from >= content.length ||
      to < 0 ||
      to >= content.length ||
      from === to
    ) {
      return;
    }
    const [moved] = content.splice(from, 1);
    content.splice(to, 0, moved!);
    pendingSnapshot = null;
    set({
      project: { ...state.project, content },
      dirty: true,
      ...pushUndo(state, snapshotOf(state)),
    });
  },

  setTitle: (title) => {
    const state = get();
    if (state.project.title === title) {
      return;
    }
    set({
      project: { ...state.project, title },
      dirty: true,
    });
  },

  applyFileEdits: (changes) => {
    const state = get();
    const entries = Object.entries(changes);
    if (entries.length === 0) {
      return;
    }

    const files = { ...state.files };
    const content = [...state.project.content];
    const styles = [...state.project.styles];

    for (const [path, text] of entries) {
      const normalized = normalizePath(path);
      files[normalized] = text;

      const isNew = !(normalized in state.files);
      if (!isNew) {
        continue;
      }

      // A new Markdown file is part of the document and a new stylesheet is
      // part of the cascade, so both are put in their place. Without this the
      // file would exist but never be rendered.
      const lower = normalized.toLowerCase();
      if (lower.endsWith('.md') && !content.includes(normalized)) {
        content.push(normalized);
      } else if (lower.endsWith('.css') && !styles.includes(normalized)) {
        styles.push(normalized);
      }
    }

    pendingSnapshot = null;
    set({
      project: { ...state.project, content, styles },
      files,
      dirty: true,
      ...pushUndo(state, snapshotOf(state)),
    });
  },

  markSaved: () => {
    set({ dirty: false });
  },

  undo: () => {
    const state = get();
    const previous = state.undoStack[state.undoStack.length - 1];
    if (!previous) {
      return;
    }
    pendingSnapshot = null;
    set({
      project: previous.project,
      files: previous.files,
      dirty: true,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, snapshotOf(state)],
    });
  },

  redo: () => {
    const state = get();
    const next = state.redoStack[state.redoStack.length - 1];
    if (!next) {
      return;
    }
    pendingSnapshot = null;
    set({
      project: next.project,
      files: next.files,
      dirty: true,
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, snapshotOf(state)],
    });
  },

  getFileText: (path) => get().files[normalizePath(path)] ?? '',
}));
