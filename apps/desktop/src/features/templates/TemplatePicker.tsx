import { useState } from 'react';

import { DOCUMENT_TEMPLATES, type DocumentTemplate } from './templates';

export interface TemplatePickerProps {
  /** Called with the template the user chose. */
  onPick: (template: DocumentTemplate) => void;
  /** Called when the user closes the picker without choosing. */
  onCancel: () => void;
}

/**
 * The list of templates a new project can start from.
 */
export function TemplatePicker({ onPick, onCancel }: TemplatePickerProps) {
  const [selectedId, setSelectedId] = useState(DOCUMENT_TEMPLATES[0]?.id ?? '');

  const selected =
    DOCUMENT_TEMPLATES.find((template) => template.id === selectedId) ?? null;

  return (
    <div className="template-picker" role="dialog" aria-label="New document">
      <div className="template-picker-panel">
        <h2 className="template-picker-title">New document</h2>

        <ul className="template-list">
          {DOCUMENT_TEMPLATES.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                className={
                  template.id === selectedId
                    ? 'template-option is-selected'
                    : 'template-option'
                }
                onClick={() => setSelectedId(template.id)}
                aria-pressed={template.id === selectedId}
              >
                <span className="template-name">{template.name}</span>
                <span className="template-description">{template.description}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="template-picker-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={() => {
              if (selected) {
                onPick(selected);
              }
            }}
          >
            Choose folder
          </button>
        </div>
      </div>
    </div>
  );
}
