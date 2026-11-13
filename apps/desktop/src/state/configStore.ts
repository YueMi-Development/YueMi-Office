import { create } from 'zustand';
import type { AppConfig, AppConfigView, ProviderConfig } from '@yuemi/protocol';

import { loadAppConfig, saveAppConfig, setProviderKey } from '../lib/appConfig';
import { reasonOf } from '../lib/tauri';

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
  /**
   * Writes the configuration.
   *
   * It answers whether the write went through, so the caller can tell the
   * user what happened instead of leaving them wondering.
   */
  save: (config: AppConfig) => Promise<boolean>;
  /**
   * Sets the key of a provider.
   *
   * Only the flag of that one provider is updated: reading the whole
   * configuration back would replace it and undo whatever the user was
   * editing at the same time.
   */
  setKey: (providerId: string, key: string) => Promise<boolean>;
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
        error: reasonOf(error, 'The settings could not be read.'),
      });
    }
  },

  save: async (config) => {
    try {
      const saved = await saveAppConfig(config);
      set({ config: saved, error: null });
      return true;
    } catch (error) {
      set({
        error: reasonOf(error, 'The settings could not be saved.'),
      });
      return false;
    }
  },

  setKey: async (providerId, key) => {
    try {
      await setProviderKey(providerId, key);
      set((state) => ({
        config: state.config
          ? {
              ...state.config,
              providers: state.config.providers.map((provider) =>
                provider.id === providerId
                  ? { ...provider, hasKey: key.trim().length > 0 }
                  : provider,
              ),
            }
          : state.config,
        error: null,
      }));
      return true;
    } catch (error) {
      set({
        error: reasonOf(error, 'The key could not be saved.'),
      });
      return false;
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
