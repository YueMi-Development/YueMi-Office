import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PAGE_BREAK } from '../../lib/pages';
import { useProjectStore } from '../../state/projectStore';
import { usePageRemoval } from './usePageRemoval';

/**
 * Asking before something is taken away.
 *
 * The point of the confirmation is that nothing is removed until the user
 * says so, so what is checked here is that a request leaves the document
 * exactly as it was, and that the removal happens only once it is confirmed.
 */

const FILE = 'content/report.typ';

describe('usePageRemoval', () => {
  beforeEach(() => {
    const store = useProjectStore.getState();
    store.newProject();
    store.addContentFile(FILE, `= One\n\n${PAGE_BREAK}\n\n= Two\n`);
  });

  it('leaves the document alone while the request is waiting', () => {
    const { result } = renderHook(() => usePageRemoval());

    act(() => {
      result.current.requestPageRemoval(FILE, 1);
    });

    expect(result.current.pendingRemoval).not.toBeNull();
    expect(useProjectStore.getState().files[FILE]).toContain('= Two');
    expect(useProjectStore.getState().project.content).toEqual([FILE]);
  });

  it('names the page that is going, by the heading it starts with', () => {
    const { result } = renderHook(() => usePageRemoval());

    act(() => {
      result.current.requestPageRemoval(FILE, 1);
    });

    expect(result.current.pendingRemoval).toMatchObject({
      kind: 'page',
      path: FILE,
      index: 1,
      title: 'Two',
    });
  });

  it('takes the page out once the removal is confirmed', () => {
    const { result } = renderHook(() => usePageRemoval());

    act(() => {
      result.current.requestPageRemoval(FILE, 1);
    });
    act(() => {
      result.current.confirmRemoval();
    });

    const text = useProjectStore.getState().files[FILE];
    expect(text).not.toContain('= Two');
    expect(text).toContain('= One');
    expect(result.current.pendingRemoval).toBeNull();
  });

  it('leaves the document alone when the removal is cancelled', () => {
    const { result } = renderHook(() => usePageRemoval());
    const before = useProjectStore.getState().files[FILE];

    act(() => {
      result.current.requestPageRemoval(FILE, 1);
    });
    act(() => {
      result.current.cancelRemoval();
    });

    expect(useProjectStore.getState().files[FILE]).toBe(before);
    expect(result.current.pendingRemoval).toBeNull();
  });

  it('leaves the file in the document while the request is waiting', () => {
    const { result } = renderHook(() => usePageRemoval());

    act(() => {
      result.current.requestFileRemoval(FILE);
    });

    expect(useProjectStore.getState().project.content).toEqual([FILE]);
  });

  it('takes the file out of the document once the removal is confirmed', () => {
    const { result } = renderHook(() => usePageRemoval());

    act(() => {
      result.current.requestFileRemoval(FILE);
    });
    act(() => {
      result.current.confirmRemoval();
    });

    expect(useProjectStore.getState().project.content).toEqual([]);
    expect(useProjectStore.getState().files[FILE]).toBeUndefined();
  });

  it('leaves the file in the document when the removal is cancelled', () => {
    const { result } = renderHook(() => usePageRemoval());

    act(() => {
      result.current.requestFileRemoval(FILE);
    });
    act(() => {
      result.current.cancelRemoval();
    });

    expect(useProjectStore.getState().project.content).toEqual([FILE]);
  });

  it('can undo a confirmed removal', () => {
    const { result } = renderHook(() => usePageRemoval());

    act(() => {
      result.current.requestFileRemoval(FILE);
    });
    act(() => {
      result.current.confirmRemoval();
    });
    act(() => {
      useProjectStore.getState().undo();
    });

    expect(useProjectStore.getState().project.content).toEqual([FILE]);
  });
});
