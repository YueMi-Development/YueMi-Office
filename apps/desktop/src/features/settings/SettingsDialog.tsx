import { useEffect, useRef, useState } from 'react';
import type { AppConfig, ProviderConfig, ProviderProtocol } from '@yuemi/protocol';

import { checkHealth } from '../../lib/api';
import { makeProvider, testProvider } from '../../lib/appConfig';
import { reasonOf } from '../../lib/tauri';
import { useConfigStore } from '../../state/configStore';

interface SettingsDialogProps {
  onClose: () => void;
}

/**
 * The settings dialog.
 *
 * The renderer lives inside the app, so there is no address to configure
 * here. The dialog still reports whether the renderer answers, because a
 * broken installation shows up there first.
 *
 * The AI section holds the providers the assistant talks to. The keys are
 * written to the user's home folder by the shell, so the key itself never
 * comes back to the page: the dialog is told only whether one is there.
 */

/** The wire formats a provider can speak. */
const PROTOCOLS: { value: ProviderProtocol; label: string }[] = [
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
];

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const config = useConfigStore((state) => state.config);
  const configError = useConfigStore((state) => state.error);
  const loadConfig = useConfigStore((state) => state.load);
  const saveConfig = useConfigStore((state) => state.save);
  const setKey = useConfigStore((state) => state.setKey);

  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string>('');
  const [aiEnabled, setAiEnabled] = useState(true);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  /**
   * The drafts are filled once, when the configuration first arrives.
   *
   * Filling them again whenever the configuration changes would throw away
   * whatever the user is editing: the configuration is replaced every time a
   * key is written, so an edit would vanish as soon as a key was saved.
   */
  const seeded = useRef(false);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (!config || seeded.current) {
      return;
    }

    seeded.current = true;
    setProviders(config.providers.map(({ hasKey: _hasKey, ...provider }) => provider));
    setActiveProviderId(config.activeProviderId);
    setActiveModel(config.activeModel ?? '');
    setAiEnabled(config.aiEnabled);
  }, [config]);

  /**
   * Writes the settings: the providers the assistant talks to.
   *
   * The key of a provider that was removed is cleared as part of the same
   * write, so a key does not stay behind for a provider that no longer
   * exists. The comparison is made against the configuration as it was read,
   * so closing the dialog without saving leaves the key where it is.
   */
  const handleSave = async () => {
    setProblem(null);
    setSaving(true);
    setStatus(null);

    try {
      // The keys of providers that are gone are cleared as part of the same
      // write. The list is taken before the write, because the write
      // replaces the configuration the comparison is made against.
      const kept = new Set(providers.map((provider) => provider.id));
      const removed = (config?.providers ?? [])
        .filter((provider) => !kept.has(provider.id))
        .map((provider) => provider.id);

      const saved: AppConfig = {
        providers,
        activeProviderId,
        activeModel: activeModel.trim() === '' ? null : activeModel,
        aiEnabled,
      };
      const written = await saveConfig(saved);
      if (!written) {
        setStatus('The settings could not be saved.');
        return;
      }

      for (const id of removed) {
        await setKey(id, '');
      }

      setStatus('The settings were saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleCheck = async () => {
    setProblem(null);
    setChecking(true);
    setStatus(null);
    try {
      const health = await checkHealth();
      setStatus(`The renderer answered (Typst ${health.typstVersion}).`);
    } catch (error) {
      setStatus(`The renderer did not answer: ${reasonOf(error, 'unknown error')}`);
    } finally {
      setChecking(false);
    }
  };

  const handleSaveKey = async (providerId: string) => {
    const key = keys[providerId] ?? '';
    const written = await setKey(providerId, key);
    if (written) {
      setKeys((state) => ({ ...state, [providerId]: '' }));
      setStatus('The key was saved.');
    }
  };

  const handleTest = async (provider: ProviderConfig) => {
    setTesting(provider.id);
    setTestResults((state) => {
      const next = { ...state };
      delete next[provider.id];
      return next;
    });
    try {
      // The provider is tried as it is on screen, so that a change to the
      // address or the model can be tried before the settings are kept. A
      // key that has only been typed is sent as it is, because the shell
      // has no key of its own to give.
      const typed = (keys[provider.id] ?? '').trim();
      const answer = await testProvider({
        id: provider.id,
        name: provider.name,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        model: provider.model,
        requiresKey: provider.requiresKey,
        apiKey: typed === '' ? undefined : typed,
      });
      setTestResults((state) => ({ ...state, [provider.id]: answer }));
    } catch (error) {
      setTestResults((state) => ({
        ...state,
        [provider.id]: reasonOf(error, 'The provider did not answer.'),
      }));
    } finally {
      setTesting(null);
    }
  };

  const handleAdd = () => {
    const id = `provider-${providers.length + 1}-${Date.now()}`;
    setProviders((state) => [
      ...state,
      makeProvider({ id, name: 'New provider', protocol: 'openai-compatible' }),
    ]);
  };

  const handleRemove = (id: string) => {
    setProviders((state) => state.filter((provider) => provider.id !== id));
    if (activeProviderId === id) {
      setActiveProviderId(null);
    }
  };

  const update = (id: string, changes: Partial<ProviderConfig>) => {
    setProviders((state) =>
      state.map((provider) =>
        provider.id === id ? { ...provider, ...changes } : provider,
      ),
    );
    // The answer that is shown belongs to the provider as it was when it
    // was tried, so it is dropped when the provider changes.
    setTestResults((state) => {
      if (!(id in state)) {
        return state;
      }
      const next = { ...state };
      delete next[id];
      return next;
    });
  };

  return (
    <div
      className="template-picker"
      role="presentation"
      onClick={(event) => {
        // The click is only a click on the backdrop when it landed on the
        // backdrop itself. A click inside the panel lands on the panel, and
        // the panel is not a button and does not need to be one.
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="template-picker-panel settings-panel"
        role="dialog"
        aria-label="Settings"
        aria-modal="true"
      >
        <h2 className="template-picker-title">Settings</h2>

        {problem && (
          <p className="settings-problem" role="alert">
            {problem}
          </p>
        )}
        {status && <p className="settings-status">{status}</p>}
        {configError && (
          <p className="settings-problem" role="alert">
            {configError}
          </p>
        )}

        <section className="settings-section">
          <h3 className="settings-subtitle">AI assistant</h3>

          <label className="settings-field settings-field-inline">
            <input
              type="checkbox"
              checked={aiEnabled}
              onChange={(event) => setAiEnabled(event.target.checked)}
            />
            <span className="settings-label">
              Let the assistant read the document and propose changes
            </span>
          </label>

          <label className="settings-field">
            <span className="settings-label">Provider</span>
            <select
              className="settings-input"
              value={activeProviderId ?? ''}
              onChange={(event) => setActiveProviderId(event.target.value || null)}
            >
              <option value="">The first one with a key</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>

          <label className="settings-field">
            <span className="settings-label">Model</span>
            <input
              className="settings-input"
              type="text"
              value={activeModel}
              spellCheck={false}
              placeholder="The provider's default model"
              onChange={(event) => setActiveModel(event.target.value)}
            />
          </label>

          <div className="settings-providers">
            {providers.map((provider) => {
              const view = config?.providers.find((entry) => entry.id === provider.id);

              return (
                <fieldset key={provider.id} className="settings-provider">
                  <legend className="settings-provider-name">{provider.name}</legend>

                  <label className="settings-field">
                    <span className="settings-label">Name</span>
                    <input
                      className="settings-input"
                      type="text"
                      value={provider.name}
                      onChange={(event) =>
                        update(provider.id, { name: event.target.value })
                      }
                    />
                  </label>

                  <label className="settings-field">
                    <span className="settings-label">Format</span>
                    <select
                      className="settings-input"
                      value={provider.protocol}
                      onChange={(event) =>
                        update(provider.id, {
                          protocol: event.target.value as ProviderProtocol,
                        })
                      }
                    >
                      {PROTOCOLS.map((protocol) => (
                        <option key={protocol.value} value={protocol.value}>
                          {protocol.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-field">
                    <span className="settings-label">Address</span>
                    <input
                      className="settings-input"
                      type="text"
                      value={provider.baseUrl}
                      spellCheck={false}
                      onChange={(event) =>
                        update(provider.id, { baseUrl: event.target.value })
                      }
                    />
                  </label>

                  <label className="settings-field">
                    <span className="settings-label">Model</span>
                    <input
                      className="settings-input"
                      type="text"
                      value={provider.model}
                      spellCheck={false}
                      onChange={(event) =>
                        update(provider.id, { model: event.target.value })
                      }
                    />
                  </label>

                  <label className="settings-field">
                    <span className="settings-label">Models offered</span>
                    <input
                      className="settings-input"
                      type="text"
                      value={provider.models.join(', ')}
                      spellCheck={false}
                      placeholder="Separated by commas"
                      onChange={(event) =>
                        update(provider.id, {
                          models: event.target.value
                            .split(',')
                            .map((model) => model.trim())
                            .filter((model) => model.length > 0),
                        })
                      }
                    />
                  </label>

                  <label className="settings-field settings-field-inline">
                    <input
                      type="checkbox"
                      checked={provider.requiresKey}
                      onChange={(event) =>
                        update(provider.id, { requiresKey: event.target.checked })
                      }
                    />
                    <span className="settings-label">Needs an API key</span>
                  </label>

                  <label className="settings-field settings-field-inline">
                    <input
                      type="checkbox"
                      checked={provider.supportsImages}
                      onChange={(event) =>
                        update(provider.id, { supportsImages: event.target.checked })
                      }
                    />
                    <span className="settings-label">
                      Can look at the rendered pages
                    </span>
                  </label>

                  {provider.requiresKey && (
                    <label className="settings-field">
                      <span className="settings-label">
                        API key {view?.hasKey ? '(a key is saved)' : '(none saved)'}
                      </span>
                      <input
                        className="settings-input"
                        type="password"
                        value={keys[provider.id] ?? ''}
                        spellCheck={false}
                        placeholder="Paste the key"
                        onChange={(event) => {
                          const key = event.target.value;
                          setKeys((state) => ({
                            ...state,
                            [provider.id]: key,
                          }));
                          // The answer that is shown belongs to the key as it
                          // was when the provider was tried, so it is dropped
                          // when the key changes.
                          setTestResults((state) => {
                            if (!(provider.id in state)) {
                              return state;
                            }
                            const next = { ...state };
                            delete next[provider.id];
                            return next;
                          });
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          void handleSaveKey(provider.id);
                        }}
                        disabled={(keys[provider.id] ?? '').trim().length === 0}
                      >
                        Save key
                      </button>
                    </label>
                  )}

                  <div className="assistant-actions">
                    <button
                      type="button"
                      onClick={() => {
                        void handleTest(provider);
                      }}
                      disabled={testing === provider.id}
                    >
                      {testing === provider.id ? 'Testing…' : 'Test provider'}
                    </button>
                    <button type="button" onClick={() => handleRemove(provider.id)}>
                      Remove
                    </button>
                  </div>

                  {testResults[provider.id] && (
                    <p className="settings-status">{testResults[provider.id]}</p>
                  )}
                </fieldset>
              );
            })}
          </div>

          <div className="assistant-actions">
            <button type="button" onClick={handleAdd}>
              Add provider
            </button>
          </div>

          {config && (
            <p className="settings-hint">
              The settings are kept in <code>{config.directory}</code>. The keys are in
              a separate file there, so the settings file can be shared without giving
              anything away.
            </p>
          )}
        </section>

        <div className="template-picker-actions">
          <button
            type="button"
            onClick={() => {
              void handleCheck();
            }}
            disabled={checking}
          >
            {checking ? 'Checking…' : 'Check renderer'}
          </button>
          <button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
