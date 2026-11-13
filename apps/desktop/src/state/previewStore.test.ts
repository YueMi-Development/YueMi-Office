import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePreviewStore } from './previewStore';
import { useProjectStore } from './projectStore';
import * as api from '../lib/api';

describe('usePreviewStore', () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
    usePreviewStore.getState().clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts idle with no PDF', () => {
    const state = usePreviewStore.getState();

    expect(state.status).toBe('idle');
    expect(state.pdf).toBeNull();
    expect(state.outline).toEqual([]);
  });

  it('does not render before the debounce elapses', async () => {
    const renderSpy = vi.spyOn(api, 'renderProject').mockResolvedValue({
      pdf: new Uint8Array([1, 2, 3]),
      outline: { entries: [], pageCount: 1 },
      warnings: [],
    });

    usePreviewStore.getState().requestRender();

    await vi.advanceTimersByTimeAsync(200);
    expect(renderSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  it('collapses rapid requests into one render', async () => {
    const renderSpy = vi.spyOn(api, 'renderProject').mockResolvedValue({
      pdf: new Uint8Array([1]),
      outline: { entries: [], pageCount: 1 },
      warnings: [],
    });

    usePreviewStore.getState().requestRender();
    await vi.advanceTimersByTimeAsync(100);
    usePreviewStore.getState().requestRender();
    await vi.advanceTimersByTimeAsync(100);
    usePreviewStore.getState().requestRender();

    await vi.advanceTimersByTimeAsync(500);

    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  it('stores the PDF and outline when a render succeeds', async () => {
    vi.spyOn(api, 'renderProject').mockResolvedValue({
      pdf: new Uint8Array([1, 2, 3]),
      outline: {
        entries: [{ title: 'Intro', level: 1, page: 0, anchor: 'intro', children: [] }],
        pageCount: 2,
      },
      warnings: [{ code: 'font.missing', message: 'Font not found' }],
    });

    usePreviewStore.getState().requestRender();
    vi.advanceTimersByTime(500);
    await vi.waitFor(() => {
      expect(usePreviewStore.getState().status).toBe('ready');
    });

    const state = usePreviewStore.getState();
    expect(state.pdf).toEqual(new Uint8Array([1, 2, 3]));
    expect(state.pageCount).toBe(2);
    expect(state.outline).toHaveLength(1);
    expect(state.warnings).toHaveLength(1);
  });

  it('records the error when a render fails', async () => {
    vi.spyOn(api, 'renderProject').mockRejectedValue(new Error('service down'));

    usePreviewStore.getState().requestRender();
    vi.advanceTimersByTime(500);
    await vi.waitFor(() => {
      expect(usePreviewStore.getState().status).toBe('error');
    });

    expect(usePreviewStore.getState().error).toBe('service down');
  });

  it('discards a stale response when a newer request was made', async () => {
    let resolveFirst:
      ((value: Awaited<ReturnType<typeof api.renderProject>>) => void) | null = null;

    const renderSpy = vi
      .spyOn(api, 'renderProject')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({
        pdf: new Uint8Array([9]),
        outline: { entries: [], pageCount: 1 },
        warnings: [],
      });

    // Start a render, then start another one before the first resolves.
    usePreviewStore.getState().requestRender();
    await vi.advanceTimersByTimeAsync(500);

    usePreviewStore.getState().requestRender();
    await vi.advanceTimersByTimeAsync(500);

    await vi.waitFor(() => {
      expect(usePreviewStore.getState().status).toBe('ready');
    });

    // The first render resolves late; it must not overwrite the newer result.
    const lateResolve = resolveFirst as
      ((value: Awaited<ReturnType<typeof api.renderProject>>) => void) | null;
    lateResolve?.({
      pdf: new Uint8Array([1]),
      outline: { entries: [], pageCount: 99 },
      warnings: [],
    });
    await Promise.resolve();

    expect(usePreviewStore.getState().pdf).toEqual(new Uint8Array([9]));
    expect(usePreviewStore.getState().pageCount).toBe(1);
    expect(renderSpy).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending render', async () => {
    const renderSpy = vi.spyOn(api, 'renderProject').mockResolvedValue({
      pdf: new Uint8Array([1]),
      outline: { entries: [], pageCount: 1 },
      warnings: [],
    });

    usePreviewStore.getState().requestRender();
    usePreviewStore.getState().cancelPending();
    vi.advanceTimersByTime(1000);

    expect(renderSpy).not.toHaveBeenCalled();
  });
});
