import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, AppConfigView, ProviderConfig } from '@yuemi/protocol';

import { useConfigStore } from '../../state/configStore';
import { useSettingsStore } from '../../state/settingsStore';
import { SettingsDialog } from './SettingsDialog';

/**
 * The settings dialog.
 *
 * The dialog is where the settings that were not written are lost, so what
 * is checked here is what happens to the user's edits: an edit must survive
 * saving a key, the Save button must write the providers as well as the
 * address of the service, and a failure must say why.
 *
 * The shell is replaced by a small store of its own, so the dialog can be
 * driven the way the real app drives it.
 */

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

interface Shell {
  providers: ProviderConfig[];
  activeProviderId: string | null;
  activeModel: string | null;
  aiEnabled: boolean;
  keys: Record<string, string>;
  /** Why the write fails, when it should fail. */
  failure: string | null;
}

let shell: Shell;

function view(): AppConfigView {
  return {
    providers: shell.providers.map((provider) => ({
      ...provider,
      hasKey: Boolean(shell.keys[provider.id]),
    })),
    activeProviderId: shell.activeProviderId,
    activeModel: shell.activeModel,
    aiEnabled: shell.aiEnabled,
    directory: '/home/user/.yuemi-office',
  };
}

function provider(id: string, name: string): ProviderConfig {
  return {
    id,
    name,
    protocol: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3',
    models: ['llama3'],
    supportsImages: false,
    requiresKey: true,
  };
}

/**
 * The address of the service is stored in the browser's storage, and the
 * browser's storage is what the test keeps between the cases.
 */
function reset(): void {
  shell = {
    providers: [provider('anthropic', 'Anthropic (Claude)'), provider('openai', 'OpenAI')],
    activeProviderId: null,
    activeModel: null,
    aiEnabled: true,
    keys: {},
    failure: null,
  };

  globalThis.localStorage?.clear();
  useConfigStore.setState({ config: null, loaded: false, error: null });
  useSettingsStore.setState({ serviceUrl: 'http://127.0.0.1:32100' });

  invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'load_app_config') {
      return view();
    }
    if (command === 'save_app_config') {
      if (shell.failure) {
        throw new Error(shell.failure);
      }
      const config = args?.config as AppConfig;
      shell.providers = config.providers;
      shell.activeProviderId = config.activeProviderId;
      shell.activeModel = config.activeModel;
      shell.aiEnabled = config.aiEnabled;
      return view();
    }
    if (command === 'set_provider_key') {
      const id = args?.providerId as string;
      const key = (args?.key as string | null) ?? '';
      if (key.trim() === '') {
        delete shell.keys[id];
      } else {
        shell.keys[id] = key;
      }
      return null;
    }
    throw new Error(`unexpected command: ${command}`);
  });
}

describe('the settings dialog', () => {
  beforeEach(() => {
    reset();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  it('keeps the edit when a key is saved', async () => {
    render(<SettingsDialog onClose={() => {}} />);
    await screen.findByDisplayValue('Anthropic (Claude)');

    const name = screen.getAllByLabelText('Name')[0] as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'My Claude' } });

    const key = screen.getAllByPlaceholderText('Paste the key')[0] as HTMLInputElement;
    fireEvent.change(key, { target: { value: 'sk-secret' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save key' })[0]);

    await waitFor(() => expect(shell.keys.anthropic).toBe('sk-secret'));
    expect((screen.getAllByLabelText('Name')[0] as HTMLInputElement).value).toBe(
      'My Claude',
    );
  });

  it('writes the providers with the Save button', async () => {
    render(<SettingsDialog onClose={() => {}} />);
    await screen.findByDisplayValue('Anthropic (Claude)');

    fireEvent.change(screen.getAllByLabelText('Name')[0] as HTMLInputElement, {
      target: { value: 'My Claude' },
    });
    fireEvent.change(screen.getByLabelText('Provider') as HTMLSelectElement, {
      target: { value: 'anthropic' },
    });
    fireEvent.change(screen.getByPlaceholderText('The provider\'s default model'), {
      target: { value: 'claude-opus-4-1' },
    });
    fireEvent.click(
      screen.getByLabelText('Let the assistant read the document and propose changes'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(shell.activeProviderId).toBe('anthropic'));
    expect(shell.providers[0].name).toBe('My Claude');
    expect(shell.activeModel).toBe('claude-opus-4-1');
    expect(shell.aiEnabled).toBe(false);
    await screen.findByText('The settings were saved.');
  });

  it('finds the settings again when the dialog is opened again', async () => {
    const first = render(<SettingsDialog onClose={() => {}} />);
    await screen.findByDisplayValue('Anthropic (Claude)');

    fireEvent.change(screen.getAllByLabelText('Name')[0] as HTMLInputElement, {
      target: { value: 'My Claude' },
    });
    fireEvent.change(screen.getByLabelText('Provider') as HTMLSelectElement, {
      target: { value: 'anthropic' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(shell.providers[0].name).toBe('My Claude'));

    first.unmount();
    render(<SettingsDialog onClose={() => {}} />);

    expect((await screen.findAllByLabelText('Name'))[0]).toHaveValue('My Claude');
    expect(screen.getByLabelText('Provider')).toHaveValue('anthropic');
  });

  it('says why the settings could not be saved', async () => {
    shell.failure = 'The disk is full.';

    render(<SettingsDialog onClose={() => {}} />);
    await screen.findByDisplayValue('Anthropic (Claude)');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('The disk is full.');
    expect(shell.providers[0].name).toBe('Anthropic (Claude)');
  });

  it('clears the key of a provider that was removed', async () => {
    shell.keys.openai = 'sk-old';

    render(<SettingsDialog onClose={() => {}} />);
    await screen.findByDisplayValue('Anthropic (Claude)');

    const remove = screen.getAllByRole('button', { name: 'Remove' })[1];
    fireEvent.click(remove);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(shell.providers).toHaveLength(1));
    await waitFor(() => expect(shell.keys.openai).toBeUndefined());
  });

  it('keeps the key when the dialog is closed without saving', async () => {
    shell.keys.openai = 'sk-old';

    render(<SettingsDialog onClose={() => {}} />);
    await screen.findByDisplayValue('Anthropic (Claude)');

    const remove = screen.getAllByRole('button', { name: 'Remove' })[1];
    fireEvent.click(remove);

    expect(shell.keys.openai).toBe('sk-old');
  });
});
