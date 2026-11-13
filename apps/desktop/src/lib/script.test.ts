import { describe, expect, it } from 'vitest';

import { parseScript, ScriptError } from './script';

const TOOLS = [
  'list_sections',
  'read_section',
  'search',
  'propose_edit',
  'set_style',
  'render_preview',
];

describe('parseScript', () => {
  it('reads a list of calls', () => {
    const calls = parseScript('[{"name": "list_sections", "arguments": {}}]', TOOLS);

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('list_sections');
    expect(calls[0].arguments).toEqual({});
  });

  it('reads a script written as an object with calls', () => {
    const calls = parseScript('{"calls": [{"name": "search"}]}', TOOLS);

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('search');
  });

  it('gives every call an identifier', () => {
    const calls = parseScript('[{"name": "list_sections"}, {"name": "search"}]', TOOLS);

    expect(calls[0].id).toBe('call-1');
    expect(calls[1].id).toBe('call-2');
  });

  it('keeps the identifier the script gave', () => {
    const calls = parseScript('[{"id": "a", "name": "search"}]', TOOLS);

    expect(calls[0].id).toBe('a');
  });

  it('keeps the arguments the script gave', () => {
    const calls = parseScript(
      '[{"name": "search", "arguments": {"query": "hello"}}]',
      TOOLS,
    );

    expect(calls[0].arguments).toEqual({ query: 'hello' });
  });

  it('reports a script that is not valid JSON', () => {
    expect(() => parseScript('not json', TOOLS)).toThrow(ScriptError);
  });

  it('reports a script that is not a list of calls', () => {
    expect(() => parseScript('{"other": 1}', TOOLS)).toThrow(ScriptError);
  });

  it('reports a call without a name', () => {
    expect(() => parseScript('[{"arguments": {}}]', TOOLS)).toThrow(ScriptError);
  });

  it('reports a call that names a tool that does not exist', () => {
    expect(() => parseScript('[{"name": "delete_everything"}]', TOOLS)).toThrow(
      ScriptError,
    );
  });

  it('says which tool was not one it knows', () => {
    expect(() => parseScript('[{"name": "delete_everything"}]', TOOLS)).toThrow(
      /delete_everything/,
    );
  });
});
