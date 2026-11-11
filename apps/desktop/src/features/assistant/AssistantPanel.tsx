import { useCallback, useEffect, useState } from 'react';

import { DiffView } from './DiffView';
import { runScript, ScriptError } from '../../lib/script';
import { listAiTools } from '../../lib/api';
import { useAssistantStore } from '../../state/assistantStore';
import { useEditorStore } from '../../state/editorStore';

export interface AssistantPanelProps {
  onClose: () => void;
}

/**
 * The assistant's panel.
 *
 * A session is run from a script — a list of tool calls written down
 * beforehand — because the assistant's tools are what the user needs to see
 * and approve, and a script exercises exactly that path without needing the
 * model (PRD section 10, milestone 3).
 *
 * The changes a session proposes are shown as differences, and each hunk can
 * be accepted or rejected on its own. The whole session becomes one
 * undoable action once the changes are applied.
 */
export function AssistantPanel({ onClose }: AssistantPanelProps) {
  const {
    pending,
    toolCalls,
    status,
    error,
    setPending,
    setToolCalls,
    setError,
    setRunning,
    acceptHunk,
    rejectHunk,
    acceptEdit,
    rejectEdit,
    acceptAll,
    rejectAll,
    applyAccepted,
    clearAnswered,
  } = useAssistantStore();

  const [script, setScript] = useState('');
  const [toolNames, setToolNames] = useState<string[]>([]);
  const setActivePath = useEditorStore((state) => state.setActivePath);

  useEffect(() => {
    let cancelled = false;
    void listAiTools()
      .then((tools) => {
        if (!cancelled) {
          setToolNames(tools.map((tool) => tool.name));
        }
      })
      .catch(() => {
        // The list is only needed to check the script, so failing to get it
        // is not worth interrupting the user over.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRun = useCallback(async () => {
    setRunning(true);
    try {
      const outcome = await runScript(script, toolNames);
      setToolCalls(outcome.session.calls);
      setPending(outcome.edits);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ScriptError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : 'The session could not be run.',
      );
    } finally {
      setRunning(false);
    }
  }, [script, toolNames, setToolCalls, setPending, setError, setRunning]);

  const handleApply = useCallback(() => {
    applyAccepted();
    clearAnswered();
  }, [applyAccepted, clearAnswered]);

  const hasAccepted = pending.some(
    (entry) =>
      !entry.rejected && entry.decisions.some((decision) => decision === 'accepted'),
  );

  return (
    <div className="assistant-panel" role="dialog" aria-label="Assistant">
      <header className="assistant-header">
        <h2 className="assistant-title">Assistant</h2>
        <button type="button" onClick={onClose} aria-label="Close the assistant">
          ×
        </button>
      </header>

      <section className="assistant-section">
        <label className="settings-field">
          <span className="settings-label">Session script</span>
          <textarea
            className="assistant-script"
            rows={4}
            spellCheck={false}
            value={script}
            onChange={(event) => setScript(event.target.value)}
            placeholder='[{"name": "list_sections", "arguments": {}}]'
          />
        </label>

        <div className="assistant-actions">
          <button type="button" onClick={handleRun} disabled={status === 'running'}>
            {status === 'running' ? 'Running…' : 'Run session'}
          </button>
          <button type="button" onClick={handleApply} disabled={!hasAccepted}>
            Apply accepted
          </button>
        </div>

        {error && (
          <p className="settings-problem" role="alert">
            {error}
          </p>
        )}
      </section>

      {toolCalls.length > 0 && (
        <section className="assistant-section">
          <h3 className="assistant-subtitle">Tools used</h3>
          <ul className="assistant-tools">
            {toolCalls.map((call) => (
              <li key={call.id} className="assistant-tool">
                <span className="assistant-tool-name">{call.name}</span>
                {call.ok ? (
                  <span className="assistant-tool-ok">ok</span>
                ) : (
                  <span className="assistant-tool-failed">{call.error}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {pending.length > 0 && (
        <section className="assistant-section">
          <h3 className="assistant-subtitle">Proposed changes</h3>

          <div className="assistant-bulk">
            <button type="button" onClick={acceptAll}>
              Accept all
            </button>
            <button type="button" onClick={rejectAll}>
              Reject all
            </button>
          </div>

          {pending.map((entry) => (
            <div key={entry.edit.id} className="assistant-edit">
              <DiffView
                edit={entry.edit}
                decisions={entry.decisions}
                onAcceptHunk={(index) => acceptHunk(entry.edit.id, index)}
                onRejectHunk={(index) => rejectHunk(entry.edit.id, index)}
                onAcceptAll={() => acceptEdit(entry.edit.id)}
                onRejectAll={() => rejectEdit(entry.edit.id)}
              />
              <button
                type="button"
                className="assistant-open-file"
                onClick={() => setActivePath(entry.edit.path)}
              >
                Open {entry.edit.path}
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
