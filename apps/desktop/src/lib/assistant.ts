import type { AiSession, AiToolCall, ProposedEdit } from '@yuemi/protocol';

import { buildAiSessionRequest, runAiSession } from './api';
import { loadProjectBinaries } from './projectAssets';
import { useProjectStore } from '../state/projectStore';

/**
 * Running the assistant's tools against the current project.
 *
 * The Rust side holds the project's files, and the app sends them along with
 * the calls. The changes the calls propose come back for the user to accept
 * or reject; nothing is written to the project until they do (PRD section 7).
 */

export interface SessionOutcome {
  session: AiSession;
  edits: ProposedEdit[];
}

/**
 * Runs a set of tool calls against the project as it is now.
 */
export async function runToolCalls(calls: AiToolCall[]): Promise<SessionOutcome> {
  const projectState = useProjectStore.getState();

  const { fonts, assets } = await loadProjectBinaries(
    projectState.rootPath,
    projectState.project.fonts ?? [],
    projectState.project.assetsDir,
  );

  const request = buildAiSessionRequest(
    projectState.project,
    projectState.files,
    assets,
    fonts,
    calls,
  );

  const session = await runAiSession(request);
  return { session, edits: session.edits };
}
