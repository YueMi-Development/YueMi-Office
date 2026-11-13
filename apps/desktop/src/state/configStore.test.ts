import { beforeEach, describe, expect, it } from 'vitest';

import { defaultAppConfig, makeProvider } from '../lib/appConfig';
import { useConfigStore } from './configStore';

/**
 * The providers the assistant can talk to.
 *
 * The store never holds a key: the shell writes it to the user's home
 * folder and the store is told only whether one is there. So what is checked
 * here is which provider is chosen and how the configuration is turned into
 * what the assistant is given.
 */
describe('the configuration store', () => {
  beforeEach(() => {
    useConfigStore.setState({ config: null, loaded: false, error: null });
  });

  it('offers the two well-known providers by default', () => {
    const config = defaultAppConfig();

    expect(config.providers.map((provider) => provider.id)).toEqual([
      'anthropic',
      'openai',
    ]);
    expect(config.aiEnabled).toBe(true);
  });

  it('gives a new provider the settings of a local server', () => {
    const provider = makeProvider({ id: 'local', name: 'Ollama' });

    expect(provider.protocol).toBe('openai-compatible');
    expect(provider.requiresKey).toBe(false);
    expect(provider.supportsImages).toBe(false);
  });

  it('keeps what the provider was given', () => {
    const provider = makeProvider({
      id: 'local',
      name: 'Ollama',
      protocol: 'openai',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3',
    });

    expect(provider.protocol).toBe('openai');
    expect(provider.baseUrl).toBe('http://localhost:11434/v1');
    expect(provider.model).toBe('llama3');
  });

  it('uses the provider the user picked', () => {
    useConfigStore.setState({
      config: {
        providers: [
          { ...makeProvider({ id: 'a', name: 'A' }), hasKey: true },
          { ...makeProvider({ id: 'b', name: 'B' }), hasKey: true },
        ],
        activeProviderId: 'b',
        activeModel: null,
        aiEnabled: true,
        directory: '',
      },
    });

    expect(useConfigStore.getState().activeProvider()?.id).toBe('b');
  });

  it('falls back to the first provider that has a key', () => {
    useConfigStore.setState({
      config: {
        providers: [
          { ...makeProvider({ id: 'a', name: 'A' }), hasKey: false },
          { ...makeProvider({ id: 'b', name: 'B' }), hasKey: true },
        ],
        activeProviderId: null,
        activeModel: null,
        aiEnabled: true,
        directory: '',
      },
    });

    expect(useConfigStore.getState().activeProvider()?.id).toBe('b');
  });

  it('falls back to the first provider when none has a key', () => {
    useConfigStore.setState({
      config: {
        providers: [{ ...makeProvider({ id: 'a', name: 'A' }), hasKey: false }],
        activeProviderId: null,
        activeModel: null,
        aiEnabled: true,
        directory: '',
      },
    });

    expect(useConfigStore.getState().activeProvider()?.id).toBe('a');
  });

  it('uses the model the user chose', () => {
    useConfigStore.setState({
      config: {
        providers: [
          { ...makeProvider({ id: 'a', name: 'A', model: 'default-model' }), hasKey: true },
        ],
        activeProviderId: null,
        activeModel: 'other-model',
        aiEnabled: true,
        directory: '',
      },
    });

    expect(useConfigStore.getState().activeProvider()?.model).toBe('other-model');
  });

  it('uses the model of the provider when the user chose none', () => {
    useConfigStore.setState({
      config: {
        providers: [
          { ...makeProvider({ id: 'a', name: 'A', model: 'default-model' }), hasKey: true },
        ],
        activeProviderId: null,
        activeModel: null,
        aiEnabled: true,
        directory: '',
      },
    });

    expect(useConfigStore.getState().activeProvider()?.model).toBe('default-model');
  });

  it('has no provider when none is set up', () => {
    useConfigStore.setState({
      config: {
        providers: [],
        activeProviderId: null,
        activeModel: null,
        aiEnabled: true,
        directory: '',
      },
    });

    expect(useConfigStore.getState().activeProvider()).toBeNull();
  });
});
