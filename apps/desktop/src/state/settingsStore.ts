import { create } from 'zustand';

import { setApiBaseUrl } from '../lib/api';
import {
  DEFAULT_SERVICE_URL,
  normalizeServiceUrl,
  validateServiceUrl,
} from '../lib/serviceUrl';

/** Where the setting is kept between runs. */
const STORAGE_KEY = 'yuemi.serviceUrl';

/**
 * Reads the saved address.
 *
 * The setting is read once at startup; a malformed saved value falls back to
 * the default rather than stopping the app from opening.
 */
export function loadStoredServiceUrl(): string {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored && !validateServiceUrl(stored)) {
      return normalizeServiceUrl(stored);
    }
  } catch {
    // Storage is not available; the default is good enough.
  }
  return DEFAULT_SERVICE_URL;
}

/**
 * Saves the address for the next run.
 */
export function storeServiceUrl(value: string): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, normalizeServiceUrl(value));
  } catch {
    // Storage is not available; the setting simply does not survive a restart.
  }
}

export interface SettingsState {
  /** The address of the render service. */
  serviceUrl: string;

  setServiceUrl: (url: string) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  serviceUrl: loadStoredServiceUrl(),

  setServiceUrl: (url) => {
    const normalized = normalizeServiceUrl(url);
    storeServiceUrl(normalized);
    setApiBaseUrl(normalized);
    set({ serviceUrl: normalized });
  },
}));

// The API module starts with its own default, so the saved address is applied
// to it as soon as the app loads.
setApiBaseUrl(useSettingsStore.getState().serviceUrl);
