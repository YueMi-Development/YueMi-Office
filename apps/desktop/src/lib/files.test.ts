import { describe, expect, it } from 'vitest';

import rustSource from '../../src-tauri/src/project.rs?raw';
import frontendSource from './files.ts?raw';

/**
 * The names the webview invokes the shell's commands by.
 *
 * Tauri registers a command under the name of its Rust function, and the
 * webview has to use that exact name. When the two disagree, every call
 * fails with "command not found" and the app cannot open, save or export a
 * project — and nothing else in the test suite notices, because the tests
 * never talk to a running Tauri shell.
 *
 * So the two lists are compared here instead: the names the frontend calls
 * and the names the shell registers.
 */

/**
 * The names the frontend invokes.
 *
 * Every `invoke` call in the frontend names one command.
 */
function frontendCommands(): string[] {
  const names = new Set<string>();

  const pattern = /invoke(?:<[^>]*>)?\(\s*'([^']+)'/g;
  let match = pattern.exec(frontendSource);
  while (match !== null) {
    names.add(match[1]);
    match = pattern.exec(frontendSource);
  }

  return [...names].sort();
}

/**
 * The names the shell registers.
 *
 * A command either renames itself or is registered under its own name. The
 * Rust functions all carry a `command_` prefix, so the ones that do not
 * rename themselves are not reachable from the webview.
 */
function shellCommands(): string[] {
  const names = new Set<string>();

  const renamed = /#\[tauri::command\(rename\s*=\s*"([^"]+)"\)\]/g;
  let match = renamed.exec(rustSource);
  while (match !== null) {
    names.add(match[1]);
    match = renamed.exec(rustSource);
  }

  // A command without a rename is registered under the name of its
  // function, so it is found by that name.
  const plain = /#\[tauri::command\]\s*pub fn (\w+)/g;
  match = plain.exec(rustSource);
  while (match !== null) {
    names.add(match[1]);
    match = plain.exec(rustSource);
  }

  return [...names].sort();
}

describe('the commands the webview invokes', () => {
  it('are all registered by the shell', () => {
    // Every name the frontend calls has to be one the shell registers. A
    // command the shell offers but the frontend never calls is harmless,
    // so only this direction is checked.
    const shell = new Set(shellCommands());

    for (const name of frontendCommands()) {
      expect(shell.has(name)).toBe(true);
    }
  });

  it('names every command the frontend calls', () => {
    // The list is spelled out so a command that is added on one side and
    // forgotten on the other shows up here rather than as a call that fails
    // in the running app.
    expect(frontendCommands()).toEqual([
      'collect_project_binaries',
      'create_project',
      'export_binary_file',
      'export_text_file',
      'open_project',
      'save_project',
      'write_project_file',
    ]);
  });
});
