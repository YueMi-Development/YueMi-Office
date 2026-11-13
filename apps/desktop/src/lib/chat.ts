import { Channel, invoke } from '@tauri-apps/api/core';
import type { AssistantEvent, AssistantMode, ChatMessage, ChatRequest } from '@yuemi/protocol';

import { loadProjectBinaries } from './projectAssets';
import { useProjectStore } from '../state/projectStore';
import { isTauri } from './tauri';

/**
 * Talking to the assistant.
 *
 * The model provider is reached from the shell, not from here: the API key
 * lives in the user's home folder and never enters the webview, so the
 * request the browser makes carries a conversation and the answer comes
 * back as events.
 */

export interface RunOptions {
  /** The conversation so far, oldest first. */
  messages: ChatMessage[];
  /** Where the render service is. */
  serviceUrl: string;
  /** Which provider to use, when the user picked one. */
  providerId?: string;
  /** Which model to use, when the user picked one. */
  model?: string;
  /** How the assistant is running. */
  mode?: AssistantMode;
  /** Called for every event of the run. */
  onEvent: (event: AssistantEvent) => void;
}

/**
 * Builds the request the shell needs, with the project's files and assets.
 */
async function buildRequest(options: RunOptions): Promise<ChatRequest> {
  const projectState = useProjectStore.getState();

  const { fonts, assets } = await loadProjectBinaries(
    projectState.rootPath,
    projectState.project.fonts ?? [],
    projectState.project.assetsDir,
  );

  return {
    messages: options.messages,
    project: projectState.project,
    files: Object.entries(projectState.files).map(([path, text]) => ({ path, text })),
    assets,
    fonts,
    serviceUrl: options.serviceUrl,
    providerId: options.providerId,
    model: options.model,
    mode: options.mode,
  };
}

/**
 * Runs the assistant and reports what happens as it happens.
 *
 * The run stops when the assistant answers without asking for a tool, when
 * it is stopped by the user, or when something goes wrong.
 */
export async function runAssistant(options: RunOptions): Promise<void> {
  if (!isTauri()) {
    throw new Error(
      'The assistant runs in the desktop app, because the key never enters the browser.',
    );
  }

  const request = await buildRequest(options);

  const channel = new Channel<AssistantEvent>();
  channel.onmessage = (event) => options.onEvent(event);

  await invoke('run_assistant', { request, channel });
}

/**
 * Stops the run that is going on.
 */
export async function cancelAssistant(): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await invoke('cancel_assistant');
}
