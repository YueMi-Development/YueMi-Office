import type { AiToolCall } from '@yuemi/protocol';

import { runToolCalls, type SessionOutcome } from './assistant';

/**
 * Running a scripted session.
 *
 * A script is a list of tool calls written down beforehand. Running one
 * exercises the whole path — the tools, the differences they produce and the
 * changes the user accepts — without needing the model, which is what makes
 * the assistant's behaviour something a test can check (PRD section 10,
 * milestone 3).
 */

/**
 * A script that could not be read.
 */
export class ScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptError';
  }
}

/**
 * Reads the tool calls out of a script.
 *
 * The script is either a list of calls or an object with a `calls` list.
 * Every call needs a name that is one of the assistant's tools, because a
 * call that names a tool that does not exist would fail in the middle of a
 * session rather than when the script is read.
 */
export function parseScript(text: string, toolNames: string[]): AiToolCall[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ScriptError(`The script is not valid JSON: ${(error as Error).message}`);
  }

  const entries = Array.isArray(parsed)
    ? parsed
    : (parsed as { calls?: unknown })?.calls;

  if (!Array.isArray(entries)) {
    throw new ScriptError('A script is a list of tool calls.');
  }

  return entries.map((entry, index) => {
    const call = entry as Partial<AiToolCall>;

    if (typeof call.name !== 'string' || !call.name) {
      throw new ScriptError(`Call ${index + 1} has no name.`);
    }
    if (!toolNames.includes(call.name)) {
      throw new ScriptError(
        `Call ${index + 1} names '${call.name}', which is not one of the assistant's tools.`,
      );
    }

    return {
      id: call.id ?? `call-${index + 1}`,
      name: call.name,
      arguments: call.arguments ?? {},
    };
  });
}

/**
 * Runs a script against the current project.
 */
export async function runScript(
  text: string,
  toolNames: string[],
): Promise<SessionOutcome> {
  return runToolCalls(parseScript(text, toolNames));
}
