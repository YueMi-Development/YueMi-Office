import { create } from 'zustand';
import type { AppConfig, AppConfigView, ProviderConfig } from '@yuemi/protocol';

import { loadAppConfig, saveAppConfig, setProviderKey } from '../lib/appConfig';

/**
 * The providers the assistant can talk to.
 *
 * The keys live in the user's home folder and are set through the shell, so
 * the webview never holds one. What is kept here is the list of providers,
 * which provider is active and whether the assistant is allowed to run.
 */

export interface ConfigState {
  /** The configuration as the app sees it. */
  config: AppConfigView | null;
  /** Whether the configuration has been read yet. */
  loaded: boolean;
  /** Why the configuration could not be read. */
  error: string | null;

  /** Reads the configuration. */
  load: () => Promise<void>;
  /** Writes the configuration. */
  save: (config: AppConfig) => Promise<void>;
  /** Sets the key of a provider. */
  setKey: (providerId: string, key: string) => Promise<void>;
  /** The provider that is active. */
  activeProvider: () => ProviderConfig | null;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: null,
  loaded: false,
  error: null,

  load: async () => {
    try {
      const config = await loadAppConfig();
      set({ config, loaded: true, error: null });
    } catch (error) {
      set({
        loaded: true,
        error: error instanceof Error ? error.message : 'The settings could not be read.',
      });
    }
  },

  save: async (config) => {
    try {
      const saved = await saveAppConfig(config);
      set({ config: saved, error: null });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'The settings could not be saved.',
      });
    }
  },

  setKey: async (providerId, key) => {
    try {
      await setProviderKey(providerId, key);
      await get().load();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'The key could not be saved.',
      });
    }
  },

  activeProvider: () => {
    const config = get().config;
    if (!config) {
      return null;
    }

    const chosen =
      config.providers.find((provider) => provider.id === config.activeProviderId) ??
      config.providers.find((provider) => provider.hasKey) ??
      config.providers[0] ??
      null;

    if (!chosen) {
      return null;
    }

    return {
      id: chosen.id,
      name: chosen.name,
      protocol: chosen.protocol,
      baseUrl: chosen.baseUrl,
      model: config.activeModel ?? chosen.model,
      models: chosen.models,
      supportsImages: chosen.supportsImages,
      requiresKey: chosen.requiresKey,
    };
  },
}));
