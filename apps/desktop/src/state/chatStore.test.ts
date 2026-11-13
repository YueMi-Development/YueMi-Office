import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from './chatStore';

/**
 * The conversation with the assistant.
 *
 * The answer arrives as a series of events, so the store is what makes the
 * text of the answer grow while the run is going on.
 */
describe('the chat store', () => {
  beforeEach(() => {
    useChatStore.getState().clear();
  });

  it('starts with nothing to say', () => {
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().transcript).toEqual([]);
    expect(useChatStore.getState().status).toBe('idle');
  });

  it('keeps what the user said', () => {
    useChatStore.getState().addUserMessage('Make the title bigger');

    const messages = useChatStore.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].text).toBe('Make the title bigger');
  });

  it('puts what the user said into the conversation', () => {
    useChatStore.getState().addUserMessage('Make the title bigger');

    expect(useChatStore.getState().transcript).toEqual([
      { role: 'user', content: [{ kind: 'text', text: 'Make the title bigger' }] },
    ]);
  });

  it('shows the answer as it arrives', () => {
    useChatStore.getState().beginRun();
    useChatStore.getState().handleEvent({ type: 'text', text: 'I made ' });
    useChatStore.getState().handleEvent({ type: 'text', text: 'the title bigger.' });

    const messages = useChatStore.getState().messages;
    expect(messages[messages.length - 1].text).toBe('I made the title bigger.');
  });

  it('shows which tools the assistant called', () => {
    useChatStore.getState().beginRun();
    useChatStore.getState().handleEvent({
      type: 'toolCall',
      id: '1',
      name: 'read_section',
      arguments: { path: 'a.md' },
    });
    useChatStore.getState().handleEvent({
      type: 'toolResult',
      id: '1',
      name: 'read_section',
      ok: true,
    });

    const messages = useChatStore.getState().messages;
    expect(messages[messages.length - 1].tools).toEqual([
      { id: '1', name: 'read_section', ok: true, error: undefined, pending: false },
    ]);
  });

  it('shows a tool that is still running', () => {
    useChatStore.getState().beginRun();
    useChatStore.getState().handleEvent({
      type: 'toolCall',
      id: '1',
      name: 'read_section',
      arguments: { path: 'a.md' },
    });

    const messages = useChatStore.getState().messages;
    expect(messages[messages.length - 1].tools[0].pending).toBe(true);
  });

  it('shows why a tool failed', () => {
    useChatStore.getState().beginRun();
    useChatStore.getState().handleEvent({
      type: 'toolResult',
      id: '1',
      name: 'read_section',
      ok: false,
      error: 'There is no file at content/nope.md in this project.',
    });

    const messages = useChatStore.getState().messages;
    expect(messages[messages.length - 1].tools[0].ok).toBe(false);
    expect(messages[messages.length - 1].tools[0].error).toBe(
      'There is no file at content/nope.md in this project.',
    );
  });

  it('reports how many pages the document had', () => {
    useChatStore.getState().handleEvent({ type: 'pages', pageCount: 7 });

    expect(useChatStore.getState().pageCount).toBe(7);
  });

  it('keeps the answer in the conversation once the run is over', () => {
    useChatStore.getState().beginRun();
    useChatStore.getState().handleEvent({ type: 'text', text: 'Done.' });
    useChatStore.getState().endRun();

    expect(useChatStore.getState().transcript).toEqual([
      { role: 'assistant', content: [{ kind: 'text', text: 'Done.' }] },
    ]);
  });

  it('leaves an answer of nothing out of the conversation', () => {
    useChatStore.getState().beginRun();
    useChatStore.getState().handleEvent({
      type: 'toolResult',
      id: '1',
      name: 'render_preview',
      ok: true,
    });
    useChatStore.getState().endRun();

    expect(useChatStore.getState().transcript).toEqual([]);
  });

  it('keeps the turns of an earlier question', () => {
    useChatStore.getState().addUserMessage('First');
    useChatStore.getState().beginRun();
    useChatStore.getState().handleEvent({ type: 'text', text: 'First answer.' });
    useChatStore.getState().endRun();

    useChatStore.getState().addUserMessage('Second');

    expect(useChatStore.getState().transcript).toHaveLength(3);
    expect(useChatStore.getState().transcript[2].role).toBe('user');
  });

  it('says why a run failed', () => {
    useChatStore.getState().failRun('The provider refused the key.');

    expect(useChatStore.getState().status).toBe('error');
    expect(useChatStore.getState().error).toBe('The provider refused the key.');
  });

  it('forgets everything when the conversation is cleared', () => {
    useChatStore.getState().addUserMessage('Something');
    useChatStore.getState().clear();

    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().transcript).toEqual([]);
  });
});
