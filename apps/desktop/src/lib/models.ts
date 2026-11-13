import { invoke } from '@tauri-apps/api/core';
import type { ModelWindow } from '@yuemi/protocol';

import { isTauri } from './tauri';

/**
 * How large a model's context is.
 *
 * The sizes come from the models.dev catalogue, which the shell keeps in
 * the configuration folder. A model the catalogue does not know has no
 * size, and nothing is guessed: the ring is left out rather than drawn
 * with a number nobody knows.
 */
export async function modelContextWindow(
  providerId: string,
  model: string,
): Promise<ModelWindow | null> {
  if (!isTauri()) {
    return null;
  }

  try {
    return await invoke<ModelWindow | null>('model_context_window', {
      providerId,
      model,
    });
  } catch {
    // The catalogue is a convenience: when it cannot be read, the app
    // simply does not show the ring.
    return null;
  }
}
