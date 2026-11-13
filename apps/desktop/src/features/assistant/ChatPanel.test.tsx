import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AppConfigView, ProviderView } from '@yuemi/protocol';

import { ChatPanel } from './ChatPanel';
import { modelContextWindow } from '../../lib/models';
import { useChatStore } from '../../state/chatStore';
import { useConfigStore } from '../../state/configStore';

/**
 * The toolbar of the chat.
 *
 * The toolbar says how the assistant is running, which model is answering
 * and how much of the model's context the conversation takes up. What is
 * checked here is that each of those can be changed from the chat itself,
 * and that the ring is only drawn when there is a size to draw it against.
 */

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

vi.mock('../../lib/models', () => ({
  modelContextWindow: vi.fn(),
}));

vi.mock('../../lib/chat', () => ({
  runAssistant: vi.fn(),
  cancelAssistant: vi.fn(),
}));

const windowOf = vi.mocked(modelContextWindow);

function provider(id: string, name: string, models: string[]): ProviderView {
  return {
    id,
    name,
    protocol: 'openai',
    baseUrl: 'https://example.test',
    model: models[0] ?? '',
    models,
    supportsImages: false,
    requiresKey: true,
    hasKey: true,
  };
}

function view(): AppConfigView {
  return {
    providers: [
      provider('anthropic', 'Anthropic', ['claude-sonnet-4-5', 'claude-opus-4-1']),
      provider('openai', 'OpenAI', ['gpt-4.1', 'gpt-4.1-mini']),
    ],
    activeProviderId: 'anthropic',
    activeModel: 'claude-sonnet-4-5',
    aiEnabled: true,
    directory: '/home/user/.yuemi-office',
  };
}

describe('the toolbar of the chat', () => {
  beforeEach(() => {
    invoke.mockReset();
    windowOf.mockReset();
    windowOf.mockResolvedValue(null);

    useChatStore.getState().clear();
    useConfigStore.setState({ config: view(), loaded: true, error: null });

    // The shell is what writes the configuration, so the test pretends to
    // be inside it.
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  it('offers the two ways the assistant can run', () => {
    render(<ChatPanel />);

    expect(screen.getByRole('button', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agent' })).toBeInTheDocument();
  });

  it('changes how the assistant runs', () => {
    render(<ChatPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));

    expect(useChatStore.getState().mode).toBe('chat');
    expect(screen.getByRole('button', { name: 'Chat' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('lists the models of every provider', () => {
    render(<ChatPanel />);

    const picker = screen.getByLabelText('Model');

    expect(
      within(picker).getByRole('option', { name: 'claude-sonnet-4-5' }),
    ).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: 'gpt-4.1' })).toBeInTheDocument();
  });

  it('chooses the provider as well as the model', async () => {
    invoke.mockResolvedValue(view());

    render(<ChatPanel />);

    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'openai::gpt-4.1' },
    });

    await waitFor(() => expect(invoke).toHaveBeenCalled());

    const [command, payload] = invoke.mock.calls[0];
    expect(command).toBe('save_app_config');
    expect(payload.config.activeProviderId).toBe('openai');
    expect(payload.config.activeModel).toBe('gpt-4.1');
  });

  it('shows the ring when the size of the context is known', async () => {
    windowOf.mockResolvedValue({
      providerId: 'anthropic',
      model: 'claude-sonnet-4-5',
      contextTokens: 200000,
      outputTokens: 64000,
    });

    useChatStore.getState().addUserMessage('What is the title?');

    render(<ChatPanel />);

    await waitFor(() =>
      expect(screen.getByRole('img', { name: /Context:/ })).toBeInTheDocument(),
    );
  });

  it('shows no ring when the size of the context is not known', async () => {
    windowOf.mockResolvedValue(null);

    useChatStore.getState().addUserMessage('What is the title?');

    render(<ChatPanel />);

    await waitFor(() => expect(windowOf).toHaveBeenCalled());

    expect(screen.queryByRole('img', { name: /Context:/ })).not.toBeInTheDocument();
  });

  it('empties the conversation when a new chat is started', async () => {
    useChatStore.getState().addUserMessage('What is the title?');

    render(<ChatPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));

    expect(useChatStore.getState().transcript).toEqual([]);

    // The lookup of the context size finishes on its own, so the test waits
    // for it rather than leaving it running past the end.
    await waitFor(() => expect(windowOf).toHaveBeenCalled());
  });
});
