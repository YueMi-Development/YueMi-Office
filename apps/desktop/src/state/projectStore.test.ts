import { beforeEach, describe, expect, it } from 'vitest';

import { useProjectStore } from './projectStore';
import { createEmptyProject } from '../lib/project';

describe('useProjectStore', () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
  });

  it('starts empty', () => {
    const state = useProjectStore.getState();

    expect(state.rootPath).toBeNull();
    expect(state.files).toEqual({});
    expect(state.dirty).toBe(false);
  });

  it('opens a project and indexes its files', () => {
    const project = createEmptyProject('Opened');

    useProjectStore.getState().openProject('/tmp/doc', project, [
      { path: 'content/a.md', text: '# A' },
      { path: 'styles/main.css', text: 'body {}' },
    ]);

    const state = useProjectStore.getState();
    expect(state.rootPath).toBe('/tmp/doc');
    expect(state.files['content/a.md']).toBe('# A');
    expect(state.dirty).toBe(false);
  });

  it('marks the project dirty when a file changes', () => {
    useProjectStore.getState().setFileText('content/a.md', 'hello');

    const state = useProjectStore.getState();
    expect(state.files['content/a.md']).toBe('hello');
    expect(state.dirty).toBe(true);
  });

  it('ignores a write that does not change the text', () => {
    useProjectStore.getState().setFileText('content/a.md', 'hello');
    useProjectStore.getState().markSaved();
    useProjectStore.getState().setFileText('content/a.md', 'hello');

    expect(useProjectStore.getState().dirty).toBe(false);
  });

  it('adds a content file to the end of the document', () => {
    useProjectStore.getState().addContentFile('content/a.md', '# A');
    useProjectStore.getState().addContentFile('content/b.md', '# B');

    expect(useProjectStore.getState().project.content).toEqual([
      'content/a.md',
      'content/b.md',
    ]);
  });

  it('does not add the same content file twice', () => {
    useProjectStore.getState().addContentFile('content/a.md', '# A');
    useProjectStore.getState().addContentFile('content/a.md', '# A again');

    expect(useProjectStore.getState().project.content).toEqual(['content/a.md']);
  });

  it('removes a content file and its text', () => {
    useProjectStore.getState().addContentFile('content/a.md', '# A');
    useProjectStore.getState().removeContentFile('content/a.md');

    const state = useProjectStore.getState();
    expect(state.project.content).toEqual([]);
    expect(state.files['content/a.md']).toBeUndefined();
  });

  it('reorders content files', () => {
    useProjectStore.getState().addContentFile('content/a.md', 'a');
    useProjectStore.getState().addContentFile('content/b.md', 'b');
    useProjectStore.getState().addContentFile('content/c.md', 'c');

    useProjectStore.getState().reorderContent(0, 2);

    expect(useProjectStore.getState().project.content).toEqual([
      'content/b.md',
      'content/c.md',
      'content/a.md',
    ]);
  });

  it('ignores an out-of-range reorder', () => {
    useProjectStore.getState().addContentFile('content/a.md', 'a');
    useProjectStore.getState().reorderContent(0, 5);

    expect(useProjectStore.getState().project.content).toEqual(['content/a.md']);
  });

  it('undoes an add and redoes it', () => {
    useProjectStore.getState().addContentFile('content/a.md', '# A');
    expect(useProjectStore.getState().project.content).toEqual(['content/a.md']);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.content).toEqual([]);

    useProjectStore.getState().redo();
    expect(useProjectStore.getState().project.content).toEqual(['content/a.md']);
  });

  it('does nothing when undoing an empty stack', () => {
    useProjectStore.getState().undo();

    expect(useProjectStore.getState().project.content).toEqual([]);
  });

  it('restores file text when undoing a committed edit', () => {
    useProjectStore.getState().addContentFile('content/a.md', '# A');
    useProjectStore.getState().setFileText('content/a.md', '# Changed');
    useProjectStore.getState().commit();

    useProjectStore.getState().undo();

    expect(useProjectStore.getState().files['content/a.md']).toBe('# A');
  });

  it('keeps the file list intact when undoing a committed edit', () => {
    useProjectStore.getState().addContentFile('content/a.md', '# A');
    useProjectStore.getState().setFileText('content/a.md', '# Changed');
    useProjectStore.getState().commit();

    useProjectStore.getState().undo();

    expect(useProjectStore.getState().project.content).toEqual(['content/a.md']);
  });

  it('clears the redo stack when a new change is made', () => {
    useProjectStore.getState().addContentFile('content/a.md', '# A');
    useProjectStore.getState().undo();
    useProjectStore.getState().addContentFile('content/b.md', '# B');

    expect(useProjectStore.getState().redoStack).toHaveLength(0);
  });

  it('marks the project saved', () => {
    useProjectStore.getState().setFileText('content/a.md', 'hello');
    useProjectStore.getState().markSaved();

    expect(useProjectStore.getState().dirty).toBe(false);
  });

  it('normalises paths written to the file map', () => {
    useProjectStore.getState().setFileText('content\\a.md', 'hello');

    expect(useProjectStore.getState().files['content/a.md']).toBe('hello');
  });
});
