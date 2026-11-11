import { create } from 'zustand';
import type { OutlineEntry, RenderWarning } from '@yuemi/protocol';

import { renderProject } from '../lib/api';
import { loadProjectBinaries } from '../lib/projectAssets';
import { useProjectStore } from './projectStore';

/** How long to wait after the last edit before rendering. */
export const RENDER_DEBOUNCE_MS = 400;

export type PreviewStatus = 'idle' | 'rendering' | 'ready' | 'error';

export interface PreviewState {
  status: PreviewStatus;
  /** The PDF currently shown in the preview. */
  pdf: Uint8Array | null;
  outline: OutlineEntry[];
  pageCount: number;
  warnings: RenderWarning[];
  error: string | null;
  /** Incremented for every render request, so stale responses can be dropped. */
  requestId: number;

  requestRender: () => void;
  cancelPending: () => void;
  clear: () => void;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export const usePreviewStore = create<PreviewState>((set, get) => ({
  status: 'idle',
  pdf: null,
  outline: [],
  pageCount: 0,
  warnings: [],
  error: null,
  requestId: 0,

  requestRender: () => {
    const state = get();
    const requestId = state.requestId + 1;
    set({ requestId });

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runRender(requestId, set, get);
    }, RENDER_DEBOUNCE_MS);
  },

  cancelPending: () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  },

  clear: () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    set({
      status: 'idle',
      pdf: null,
      outline: [],
      pageCount: 0,
      warnings: [],
      error: null,
    });
  },
}));

async function runRender(
  requestId: number,
  set: (partial: Partial<PreviewState>) => void,
  get: () => PreviewState,
): Promise<void> {
  const projectState = useProjectStore.getState();

  const { fonts, assets } = await loadProjectBinaries(
    projectState.rootPath,
    projectState.project.fonts ?? [],
    projectState.project.assetsDir,
  );

  // Reading the binaries takes a moment, and a newer request may have been
  // made in the meantime.
  if (get().requestId !== requestId) {
    return;
  }

  const request = {
    project: projectState.project,
    files: Object.entries(projectState.files).map(([path, text]) => ({
      path,
      text,
    })),
    assets,
    fonts,
  };

  set({ status: 'rendering', error: null });

  try {
    const result = await renderProject(request);

    // A newer request has been made since this one started, so its result
    // is the one the user is waiting for.
    if (get().requestId !== requestId) {
      return;
    }

    set({
      status: 'ready',
      pdf: result.pdf,
      outline: result.outline.entries,
      pageCount: result.outline.pageCount,
      warnings: result.warnings,
      error: null,
    });
  } catch (error) {
    if (get().requestId !== requestId) {
      return;
    }
    set({
      status: 'error',
      error: error instanceof Error ? error.message : 'Render failed',
    });
  }
}
