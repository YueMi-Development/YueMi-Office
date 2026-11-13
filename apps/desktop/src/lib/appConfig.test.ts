import { beforeEach, describe, expect, it } from 'vitest';

import {
  configDirectory,
  defaultAppConfig,
  loadAppConfig,
  saveAppConfig,
  setProviderKey,
  testProvider,
} from './appConfig';

/**
 * The application's own configuration.
 *
 * The frontend is also opened directly in a browser during development, and
 * then there is no shell to ask, so the configuration is kept in the
 * browser's storage instead. These tests cover that path, which is the one
 * a test can reach without the desktop app.
 */
describe('the app configuration in the browser', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  it('starts from the default configuration', async () => {
    const config = await loadAppConfig();

    expect(config.providers.map((provider) => provider.id)).toEqual([
      'anthropic',
      'openai',
    ]);
    expect(config.aiEnabled).toBe(true);
  });

  it('reads back what was stored', async () => {
    const config = defaultAppConfig();
    config.activeModel = 'gpt-4.1-mini';
    config.aiEnabled = false;

    await saveAppConfig(config);

    const stored = await loadAppConfig();
    expect(stored.activeModel).toBe('gpt-4.1-mini');
    expect(stored.aiEnabled).toBe(false);
  });

  it('keeps a provider the user added', async () => {
    const config = defaultAppConfig();
    config.providers = [
      ...config.providers,
      {
        id: 'local',
        name: 'Local',
        protocol: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'llama3',
        models: ['llama3'],
        supportsImages: false,
        requiresKey: false,
      },
    ];

    await saveAppConfig(config);

    const stored = await loadAppConfig();
    expect(stored.providers.map((provider) => provider.id)).toEqual([
      'anthropic',
      'openai',
      'local',
    ]);
  });

  it('says that no key is set, because no key is in the browser', async () => {
    const config = await loadAppConfig();

    expect(config.providers.every((provider) => provider.hasKey === false)).toBe(true);
  });

  it('reports that a key was set, without ever returning it', async () => {
    const set = await setProviderKey('anthropic', 'sk-secret');

    expect(set).toBe(true);

    const config = await loadAppConfig();
    expect(JSON.stringify(config)).not.toContain('sk-secret');
  });

  it('does not count a blank key as a key', async () => {
    const set = await setProviderKey('anthropic', '   ');

    expect(set).toBe(false);
  });

  it('says where the settings live', async () => {
    const directory = await configDirectory();

    expect(directory).toBe('browser storage');
  });

  it('refuses to check the connection, because the key never enters the browser', async () => {
    await expect(
      testProvider({
        id: 'anthropic',
        name: 'Anthropic (Claude)',
        protocol: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-5',
        requiresKey: true,
      }),
    ).rejects.toThrow(
      'The connection can only be checked in the desktop app, because the key never enters the browser.',
    );
  });
});
