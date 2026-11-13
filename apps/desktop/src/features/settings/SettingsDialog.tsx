import { useEffect, useState } from 'react';
import type { AppConfig, ProviderConfig, ProviderProtocol } from '@yuemi/protocol';

import { checkHealth } from '../../lib/api';
import { makeProvider, testProvider } from '../../lib/appConfig';
import { DEFAULT_SERVICE_URL, validateServiceUrl } from '../../lib/serviceUrl';
import { useConfigStore } from '../../state/configStore';
import { useSettingsStore } from '../../state/settingsStore';

interface SettingsDialogProps {
  onClose: () => void;
}

/**
 * The settings dialog.
 *
 * The render service is hosted for v1 (PRD section 11), so its address is a
 * setting rather than a constant in the bundle. The dialog also reports
 * whether the service answers, because a wrong address is the most common
 * reason for a document that will not preview.
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
  const serviceUrl = useSettingsStore((state) => state.serviceUrl);
  const setServiceUrl = useSettingsStore((state) => state.setServiceUrl);

  const config = useConfigStore((state) => state.config);
  const loadConfig = useConfigStore((state) => state.load);
  const saveConfig = useConfigStore((state) => state.save);
  const setKey = useConfigStore((state) => state.setKey);

  const [draft, setDraft] = useState(serviceUrl);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string>('');
  const [aiEnabled, setAiEnabled] = useState(true);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    setDraft(serviceUrl);
  }, [serviceUrl]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (!config) {
      return;
    }

    setProviders(config.providers.map(({ hasKey: _hasKey, ...provider }) => provider));
    setActiveProviderId(config.activeProviderId);
    setActiveModel(config.activeModel ?? '');
    setAiEnabled(config.aiEnabled);
  }, [config]);

  const handleSave = () => {
    const issue = validateServiceUrl(draft);
    if (issue) {
      setProblem(issue);
      return;
    }
    setProblem(null);
    setServiceUrl(draft);
    setStatus(null);
  };

  const handleCheck = async () => {
    const issue = validateServiceUrl(draft);
    if (issue) {
      setProblem(issue);
      return;
    }

    setProblem(null);
    setChecking(true);
    setStatus(null);
    try {
      setServiceUrl(draft);
      const health = await checkHealth();
      setStatus(
        `The render service answered (WeasyPrint ${health.weasyprintVersion}).`,
      );
    } catch (error) {
      setStatus(
        `Could not reach the service: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    } finally {
      setChecking(false);
    }
  };

  const handleSaveProviders = async () => {
    const saved: AppConfig = {
      providers,
      activeProviderId,
      activeModel: activeModel.trim() === '' ? null : activeModel,
      aiEnabled,
    };
    await saveConfig(saved);
  };

  const handleSaveKey = async (providerId: string) => {
    const key = keys[providerId] ?? '';
    await setKey(providerId, key);
    setKeys((state) => ({ ...state, [providerId]: '' }));
  };

  const handleTest = async (provider: ProviderConfig) => {
    setTesting(provider.id);
    setTestResult(null);
    try {
      const answer = await testProvider(provider.id, provider.model);
      setTestResult(answer);
    } catch (error) {
      setTestResult(
        error instanceof Error ? error.message : 'The provider did not answer.',
      );
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
  };

  return (
    <div className="template-picker" role="presentation" onClick={onClose}>
      <div
        className="template-picker-panel settings-panel"
        role="dialog"
        aria-label="Settings"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="template-picker-title">Settings</h2>

        <label className="settings-field">
          <span className="settings-label">Render service address</span>
          <input
            className="settings-input"
            type="text"
            value={draft}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={DEFAULT_SERVICE_URL}
          />
        </label>

        {problem && (
          <p className="settings-problem" role="alert">
            {problem}
          </p>
        )}
        {status && <p className="settings-status">{status}</p>}

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
                    <span className="settings-label">Can look at the rendered pages</span>
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
                        onChange={(event) =>
                          setKeys((state) => ({
                            ...state,
                            [provider.id]: event.target.value,
                          }))
                        }
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveKey(provider.id)}
                        disabled={(keys[provider.id] ?? '').trim().length === 0}
                      >
                        Save key
                      </button>
                    </label>
                  )}

                  <div className="assistant-actions">
                    <button
                      type="button"
                      onClick={() => handleTest(provider)}
                      disabled={testing === provider.id}
                    >
                      {testing === provider.id ? 'Testing…' : 'Test connection'}
                    </button>
                    <button type="button" onClick={() => handleRemove(provider.id)}>
                      Remove
                    </button>
                  </div>
                </fieldset>
              );
            })}
          </div>

          {testResult && <p className="settings-status">{testResult}</p>}

          <div className="assistant-actions">
            <button type="button" onClick={handleAdd}>
              Add provider
            </button>
            <button type="button" onClick={handleSaveProviders}>
              Save providers
            </button>
          </div>

          {config && (
            <p className="settings-hint">
              The settings are kept in <code>{config.directory}</code>. The keys are in a
              separate file there, so the settings file can be shared without giving
              anything away.
            </p>
          )}
        </section>

        <div className="template-picker-actions">
          <button type="button" onClick={handleCheck} disabled={checking}>
            {checking ? 'Checking…' : 'Test connection'}
          </button>
          <button type="button" onClick={handleSave}>
            Save
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
