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
      { path: 'content/a.typ', text: '= A' },
      { path: 'theme.typ', text: '#let theme(body) = body' },
    ]);

    const state = useProjectStore.getState();
    expect(state.rootPath).toBe('/tmp/doc');
    expect(state.files['content/a.typ']).toBe('= A');
    expect(state.dirty).toBe(false);
  });

  it('marks the project dirty when a file changes', () => {
    useProjectStore.getState().setFileText('content/a.typ', 'hello');

    const state = useProjectStore.getState();
    expect(state.files['content/a.typ']).toBe('hello');
    expect(state.dirty).toBe(true);
  });

  it('ignores a write that does not change the text', () => {
    useProjectStore.getState().setFileText('content/a.typ', 'hello');
    useProjectStore.getState().markSaved();
    useProjectStore.getState().setFileText('content/a.typ', 'hello');

    expect(useProjectStore.getState().dirty).toBe(false);
  });

  it('adds a content file to the end of the document', () => {
    useProjectStore.getState().addContentFile('content/a.typ', '# A');
    useProjectStore.getState().addContentFile('content/b.typ', '# B');

    expect(useProjectStore.getState().project.content).toEqual([
      'content/a.typ',
      'content/b.typ',
    ]);
  });

  it('does not add the same content file twice', () => {
    useProjectStore.getState().addContentFile('content/a.typ', '# A');
    useProjectStore.getState().addContentFile('content/a.typ', '# A again');

    expect(useProjectStore.getState().project.content).toEqual(['content/a.typ']);
  });

  it('removes a content file and its text', () => {
    useProjectStore.getState().addContentFile('content/a.typ', '# A');
    useProjectStore.getState().removeContentFile('content/a.typ');

    const state = useProjectStore.getState();
    expect(state.project.content).toEqual([]);
    expect(state.files['content/a.typ']).toBeUndefined();
  });

  it('reorders content files', () => {
    useProjectStore.getState().addContentFile('content/a.typ', 'a');
    useProjectStore.getState().addContentFile('content/b.typ', 'b');
    useProjectStore.getState().addContentFile('content/c.typ', 'c');

    useProjectStore.getState().reorderContent(0, 2);

    expect(useProjectStore.getState().project.content).toEqual([
      'content/b.typ',
      'content/c.typ',
      'content/a.typ',
    ]);
  });

  it('ignores an out-of-range reorder', () => {
    useProjectStore.getState().addContentFile('content/a.typ', 'a');
    useProjectStore.getState().reorderContent(0, 5);

    expect(useProjectStore.getState().project.content).toEqual(['content/a.typ']);
  });

  it('undoes an add and redoes it', () => {
    useProjectStore.getState().addContentFile('content/a.typ', '# A');
    expect(useProjectStore.getState().project.content).toEqual(['content/a.typ']);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.content).toEqual([]);

    useProjectStore.getState().redo();
    expect(useProjectStore.getState().project.content).toEqual(['content/a.typ']);
  });

  it('does nothing when undoing an empty stack', () => {
    useProjectStore.getState().undo();

    expect(useProjectStore.getState().project.content).toEqual([]);
  });

  it('restores file text when undoing a committed edit', () => {
    useProjectStore.getState().addContentFile('content/a.typ', '# A');
    useProjectStore.getState().setFileText('content/a.typ', '# Changed');
    useProjectStore.getState().commit();

    useProjectStore.getState().undo();

    expect(useProjectStore.getState().files['content/a.typ']).toBe('# A');
  });

  it('keeps the file list intact when undoing a committed edit', () => {
    useProjectStore.getState().addContentFile('content/a.typ', '# A');
    useProjectStore.getState().setFileText('content/a.typ', '# Changed');
    useProjectStore.getState().commit();

    useProjectStore.getState().undo();

    expect(useProjectStore.getState().project.content).toEqual(['content/a.typ']);
  });

  it('clears the redo stack when a new change is made', () => {
    useProjectStore.getState().addContentFile('content/a.typ', '# A');
    useProjectStore.getState().undo();
    useProjectStore.getState().addContentFile('content/b.typ', '# B');

    expect(useProjectStore.getState().redoStack).toHaveLength(0);
  });

  it('marks the project saved', () => {
    useProjectStore.getState().setFileText('content/a.typ', 'hello');
    useProjectStore.getState().markSaved();

    expect(useProjectStore.getState().dirty).toBe(false);
  });

  it('normalises paths written to the file map', () => {
    useProjectStore.getState().setFileText('content\\a.typ', 'hello');

    expect(useProjectStore.getState().files['content/a.typ']).toBe('hello');
  });

  it('puts several changed files in at once', () => {
    useProjectStore.getState().applyFileEdits({
      'content/a.typ': '# A',
      'theme.typ': 'body {}',
    });

    const state = useProjectStore.getState();
    expect(state.files['content/a.typ']).toBe('# A');
    expect(state.files['theme.typ']).toBe('body {}');
    expect(state.dirty).toBe(true);
  });

  it('makes several changed files one undoable action', () => {
    useProjectStore.getState().applyFileEdits({ 'content/a.typ': '# A' });
    useProjectStore.getState().applyFileEdits({ 'content/b.typ': '# B' });

    useProjectStore.getState().undo();

    expect(useProjectStore.getState().files['content/b.typ']).toBeUndefined();
    expect(useProjectStore.getState().files['content/a.typ']).toBe('# A');
  });

  it('adds a new content file to the document order', () => {
    useProjectStore.getState().applyFileEdits({ 'content/new.typ': '# New' });

    expect(useProjectStore.getState().project.content).toContain('content/new.typ');
  });

  it('makes a new theme file the project theme', () => {
    useProjectStore.getState().applyFileEdits({
      'theme.typ': '#let theme(body) = body',
    });

    expect(useProjectStore.getState().project.theme).toBe('theme.typ');
    expect(useProjectStore.getState().project.content).not.toContain('theme.typ');
  });

  it('leaves the theme alone when an existing file changes', () => {
    useProjectStore.getState().applyFileEdits({ 'content/a.typ': '= A' });

    expect(useProjectStore.getState().project.theme).toBeNull();
  });

  it('does not put a file that is already there in the document twice', () => {
    useProjectStore.getState().addContentFile('content/a.typ', '# A');
    useProjectStore.getState().applyFileEdits({ 'content/a.typ': '# Changed' });

    expect(useProjectStore.getState().project.content).toEqual(['content/a.typ']);
  });

  it('ignores a change that changes nothing', () => {
    useProjectStore.getState().applyFileEdits({});

    expect(useProjectStore.getState().dirty).toBe(false);
    expect(useProjectStore.getState().undoStack).toHaveLength(0);
  });
});
