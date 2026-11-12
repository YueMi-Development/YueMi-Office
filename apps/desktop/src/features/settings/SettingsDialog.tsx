import { useEffect, useState } from 'react';

import { checkHealth } from '../../lib/api';
import { DEFAULT_SERVICE_URL, validateServiceUrl } from '../../lib/serviceUrl';
import { useSettingsStore } from '../../state/settingsStore';

interface SettingsDialogProps {
  onClose: () => void;
}

/**
 * The settings dialog.
 *
 * The render service is hosted for v1 (PRD section 11), so its address is a
 * setting rather than a constant in the bundle. The dialog also reports
 * whether the service answers, because a wrong address is the most common
 * reason for a document that will not preview.
 */
export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const serviceUrl = useSettingsStore((state) => state.serviceUrl);
  const setServiceUrl = useSettingsStore((state) => state.setServiceUrl);

  const [draft, setDraft] = useState(serviceUrl);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setDraft(serviceUrl);
  }, [serviceUrl]);

  const handleSave = () => {
    const issue = validateServiceUrl(draft);
    if (issue) {
      setProblem(issue);
      return;
    }
    setProblem(null);
    setServiceUrl(draft);
    setStatus(null);
  };

  const handleCheck = async () => {
    const issue = validateServiceUrl(draft);
    if (issue) {
      setProblem(issue);
      return;
    }

    setProblem(null);
    setChecking(true);
    setStatus(null);
    try {
      setServiceUrl(draft);
      const health = await checkHealth();
      setStatus(
        `The render service answered (WeasyPrint ${health.weasyprintVersion}).`,
      );
    } catch (error) {
      setStatus(
        `Could not reach the service: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="template-picker" role="presentation" onClick={onClose}>
      <div
        className="template-picker-panel"
        role="dialog"
        aria-label="Settings"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="template-picker-title">Settings</h2>

        <label className="settings-field">
          <span className="settings-label">Render service address</span>
          <input
            className="settings-input"
            type="text"
            value={draft}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={DEFAULT_SERVICE_URL}
          />
        </label>

        {problem && (
          <p className="settings-problem" role="alert">
            {problem}
          </p>
        )}
        {status && <p className="settings-status">{status}</p>}

        <div className="template-picker-actions">
          <button type="button" onClick={handleCheck} disabled={checking}>
            {checking ? 'Checking…' : 'Test connection'}
          </button>
          <button type="button" onClick={handleSave}>
            Save
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
