import { invoke } from '@tauri-apps/api/core';
import type {
  AppConfig,
  AppConfigView,
  ProviderConfig,
} from '@yuemi/protocol';

import { isTauri } from './tauri';

/**
 * The application's own configuration.
 *
 * The configuration lives in the user's home folder rather than in the
 * bundle, so a provider the user added is still there after the app is
 * reinstalled. The keys live in a separate file that the webview never
 * reads: the app asks the shell to set a key and is told only whether one
 * is there.
 *
 * When the frontend is opened directly in a browser there is no shell to
 * ask, so the configuration is kept in the browser's storage instead. That
 * is only good enough for development, and the assistant says so.
 */

/** Where the browser keeps the configuration during development. */
const STORAGE_KEY = 'yuemi.appConfig';

/** The configuration used when there is nothing else. */
export function defaultAppConfig(): AppConfig {
  return {
    providers: [
      {
        id: 'anthropic',
        name: 'Anthropic (Claude)',
        protocol: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-5',
        models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
        supportsImages: true,
        requiresKey: true,
      },
      {
        id: 'openai',
        name: 'OpenAI',
        protocol: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1',
        models: ['gpt-4.1', 'gpt-4.1-mini'],
        supportsImages: true,
        requiresKey: true,
      },
    ],
    activeProviderId: null,
    activeModel: null,
    aiEnabled: true,
  };
}

/**
 * Reads the configuration from the browser's storage.
 */
function loadStoredConfig(): AppConfig {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as AppConfig;
      if (parsed && Array.isArray(parsed.providers)) {
        return parsed;
      }
    }
  } catch {
    // The stored value is not readable; the default is good enough.
  }
  return defaultAppConfig();
}

/**
 * Keeps the configuration in the browser's storage.
 */
function storeConfig(config: AppConfig): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Storage is not available; the setting simply does not survive a reload.
  }
}

/**
 * The configuration the webview sees, built from what the shell reports.
 */
function viewOf(config: AppConfig, directory: string): AppConfigView {
  return {
    providers: config.providers.map((provider) => ({ ...provider, hasKey: false })),
    activeProviderId: config.activeProviderId,
    activeModel: config.activeModel,
    aiEnabled: config.aiEnabled,
    directory,
  };
}

/**
 * Reads the configuration.
 */
export async function loadAppConfig(): Promise<AppConfigView> {
  if (!isTauri()) {
    return viewOf(loadStoredConfig(), 'browser storage');
  }

  return invoke<AppConfigView>('load_app_config');
}

/**
 * Writes the configuration.
 */
export async function saveAppConfig(config: AppConfig): Promise<AppConfigView> {
  if (!isTauri()) {
    storeConfig(config);
    return viewOf(config, 'browser storage');
  }

  await invoke('save_app_config', { config });
  return invoke<AppConfigView>('load_app_config');
}

/**
 * Sets the key of one provider, or clears it when the key is empty.
 *
 * The key never travels back to the webview: the app is told only whether
 * a key is there.
 */
export async function setProviderKey(
  providerId: string,
  key: string,
): Promise<boolean> {
  if (!isTauri()) {
    return key.trim().length > 0;
  }

  await invoke('set_provider_key', { providerId, key });
  return key.trim().length > 0;
}

/**
 * Reports where the configuration lives.
 */
export async function configDirectory(): Promise<string> {
  if (!isTauri()) {
    return 'browser storage';
  }

  return invoke<string>('config_directory');
}

/**
 * Checks that a provider answers, so the settings can say whether the key
 * works.
 */
export async function testProvider(
  providerId?: string,
  model?: string,
): Promise<string> {
  if (!isTauri()) {
    throw new Error(
      'The connection can only be checked in the desktop app, because the key never enters the browser.',
    );
  }

  return invoke<string>('test_provider', { providerId, model });
}

/**
 * Builds a provider with the fields the app expects.
 */
export function makeProvider(
  partial: Partial<ProviderConfig> & { id: string; name: string },
): ProviderConfig {
  return {
    protocol: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: '',
    models: [],
    supportsImages: false,
    requiresKey: false,
    ...partial,
  };
}
