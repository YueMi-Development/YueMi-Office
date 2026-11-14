import { invoke } from '@tauri-apps/api/core';
import type {
  AiSession,
  AiSessionRequest,
  AiToolCall,
  AiToolDescription,
  HealthResponse,
  OutlineEntry,
  RenderOutline,
  RenderRequest,
  RenderWarning,
} from '@yuemi/protocol';

/**
 * Talking to the renderer and to the assistant's tools.
 *
 * Both live in the app's own Rust core, so there is no service to reach and
 * no address to configure: the calls go through the shell and never leave
 * the machine.
 */

export interface RenderResult {
  pdf: Uint8Array;
  outline: RenderOutline;
  warnings: RenderWarning[];
}

/**
 * Turns base64 into bytes.
 *
 * The shell hands a PDF back as base64, because a command's return value is
 * JSON and a PDF as a list of numbers would be enormous.
 */
export function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Renders a project and returns the PDF together with its outline.
 *
 * The outline comes from the same render, so its page numbers always match
 * the PDF the preview shows.
 */
export async function renderProject(request: RenderRequest): Promise<RenderResult> {
  const result = await invoke<{
    pdf: string;
    outline: RenderOutline;
    warnings: RenderWarning[];
  }>('render_project', { request });

  return {
    pdf: decodeBase64(result.pdf),
    outline: {
      entries: result.outline?.entries ?? [],
      pageCount: result.outline?.pageCount ?? 0,
    },
    warnings: result.warnings ?? [],
  };
}

/**
 * Renders a project and returns only its outline.
 */
export async function fetchOutline(request: RenderRequest): Promise<RenderOutline> {
  const outline = await invoke<RenderOutline>('render_project_outline', { request });

  return {
    entries: outline?.entries ?? [],
    pageCount: outline?.pageCount ?? 0,
  };
}

/**
 * Says whether the renderer is working, and with what.
 */
export async function checkHealth(): Promise<HealthResponse> {
  return invoke<HealthResponse>('render_health');
}

/**
 * Lists the tools the assistant can use.
 *
 * The app sends this to the model provider, so the assistant is told what
 * it may do rather than what the user typed.
 */
export async function listAiTools(): Promise<AiToolDescription[]> {
  return invoke<AiToolDescription[]>('list_ai_tools');
}

/**
 * Runs a session of tool calls against a project.
 *
 * The calls run against the project's own files, with no access to the
 * user's disk. The changes the calls propose come back for the user to
 * accept or reject.
 */
export async function runAiSession(request: AiSessionRequest): Promise<AiSession> {
  const { project, files, assets, fonts, calls } = request;

  return invoke<AiSession>('run_ai_session', {
    project,
    files,
    assets,
    fonts,
    calls: calls.map((call) => ({
      id: call.id ?? '',
      name: call.name,
      arguments: call.arguments ?? {},
    })),
  });
}

/**
 * Builds the request that runs a session against the current project.
 */
export function buildAiSessionRequest(
  project: RenderRequest['project'],
  files: Record<string, string>,
  assets: RenderRequest['assets'],
  fonts: RenderRequest['fonts'],
  calls: AiToolCall[],
): AiSessionRequest {
  return {
    project,
    files: Object.entries(files).map(([path, text]) => ({ path, text })),
    assets,
    fonts,
    calls,
  };
}

/**
 * Flattens the outline into a list, preserving document order.
 */
export function flattenOutline(entries: OutlineEntry[]): OutlineEntry[] {
  const result: OutlineEntry[] = [];

  const visit = (index: number) => {
    const entry = entries[index];
    if (!entry) {
      return;
    }
    result.push(entry);
    for (const child of entry.children ?? []) {
      visit(child);
    }
  };

  for (let index = 0; index < entries.length; index += 1) {
    visit(index);
  }

  return result;
}
