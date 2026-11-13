import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore, usageOf } from './chatStore';

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

  it('keeps what was said when a run fails', () => {
    useChatStore.getState().beginRun();
    useChatStore.getState().handleEvent({ type: 'text', text: 'I looked at the title.' });
    useChatStore.getState().failRun('The provider refused the key.');

    const messages = useChatStore.getState().messages;
    expect(messages[messages.length - 1].text).toBe('I looked at the title.');
  });

  it('marks a run as going on', () => {
    useChatStore.getState().beginRun();

    expect(useChatStore.getState().status).toBe('running');
  });

  it('forgets the error of an earlier run when a new one starts', () => {
    useChatStore.getState().failRun('The provider refused the key.');

    useChatStore.getState().beginRun();

    expect(useChatStore.getState().error).toBeNull();
  });

  it('forgets everything when the conversation is cleared', () => {
    useChatStore.getState().addUserMessage('Something');
    useChatStore.getState().clear();

    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().transcript).toEqual([]);
  });

  it('forgets the state of the run when the conversation is cleared', () => {
    useChatStore.getState().beginRun();
    useChatStore.getState().handleEvent({ type: 'pages', pageCount: 7 });
    useChatStore.getState().failRun('The provider refused the key.');

    useChatStore.getState().clear();

    expect(useChatStore.getState().status).toBe('idle');
    expect(useChatStore.getState().error).toBeNull();
    expect(useChatStore.getState().pageCount).toBeNull();
  });

  it('gives the assistant the conversation of the finished turns', () => {
    useChatStore.getState().addUserMessage('What is the title?');
    useChatStore.getState().beginRun();
    useChatStore.getState().handleEvent({ type: 'text', text: 'It is The title.' });
    useChatStore.getState().endRun();

    const messages = useChatStore.getState().toChatMessages();

    expect(messages).toEqual([
      { role: 'user', content: [{ kind: 'text', text: 'What is the title?' }] },
      { role: 'assistant', content: [{ kind: 'text', text: 'It is The title.' }] },
    ]);
  });

  it('runs as the agent until the user says otherwise', () => {
    expect(useChatStore.getState().mode).toBe('agent');

    useChatStore.getState().setMode('chat');

    expect(useChatStore.getState().mode).toBe('chat');
  });

  it('keeps how much of the context the turn used', () => {
    useChatStore.getState().handleEvent({
      type: 'usage',
      usage: { inputTokens: 1200, outputTokens: 40 },
    });

    expect(useChatStore.getState().usage).toEqual({
      tokens: 1240,
      estimated: false,
    });
  });

  it('forgets the usage when the conversation is cleared', () => {
    useChatStore.getState().handleEvent({
      type: 'usage',
      usage: { inputTokens: 1200, outputTokens: 40 },
    });

    useChatStore.getState().clear();

    expect(useChatStore.getState().usage).toBeNull();
  });

  it('estimates the size of the conversation when the provider said nothing', () => {
    const state = useChatStore.getState();
    state.addUserMessage('Make the title bigger');

    const usage = usageOf(null, useChatStore.getState().transcript);

    expect(usage?.estimated).toBe(true);
    // Twenty-one characters, at about four to a token.
    expect(usage?.tokens).toBe(6);
  });

  it('prefers what the provider said over the estimate', () => {
    const state = useChatStore.getState();
    state.addUserMessage('Make the title bigger');

    const usage = usageOf(
      { tokens: 1200, estimated: false },
      useChatStore.getState().transcript,
    );

    expect(usage).toEqual({ tokens: 1200, estimated: false });
  });

  it('has no size for a conversation that is empty', () => {
    expect(usageOf(null, [])).toBeNull();
  });
});
