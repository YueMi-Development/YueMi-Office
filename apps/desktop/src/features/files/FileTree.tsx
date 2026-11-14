import { useMemo } from 'react';

import { basename } from '../../lib/project';

export interface FileTreeProps {
  content: string[];
  /** The project's theme file, shown apart from the document's own files. */
  theme?: string | null;
  activePath: string | null;
  onSelect: (path: string) => void;
  onRemove?: (path: string) => void;
  onMove?: (from: number, to: number) => void;
}

export function FileTree({
  content,
  theme = null,
  activePath,
  onSelect,
  onRemove,
  onMove,
}: FileTreeProps) {
  const files = useMemo(
    () =>
      content.map((path, index) => ({
        path,
        name: basename(path),
        index,
      })),
    [content],
  );

  if (files.length === 0 && !theme) {
    return <div className="file-tree-empty">No content files yet.</div>;
  }

  return (
    <ul className="file-tree">
      {files.map((file) => (
        <li key={file.path} className="file-tree-item">
          <button
            type="button"
            className={`file-tree-button${file.path === activePath ? ' is-active' : ''}`}
            onClick={() => onSelect(file.path)}
            title={file.path}
          >
            {file.name}
          </button>

          {onMove && (
            <span className="file-tree-actions">
              <button
                type="button"
                onClick={() => onMove(file.index, file.index - 1)}
                disabled={file.index === 0}
                aria-label={`Move ${file.name} up`}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => onMove(file.index, file.index + 1)}
                disabled={file.index === files.length - 1}
                aria-label={`Move ${file.name} down`}
              >
                ↓
              </button>
            </span>
          )}

          {onRemove && (
            <button
              type="button"
              className="file-tree-remove"
              onClick={() => onRemove(file.path)}
              aria-label={`Remove ${file.name}`}
            >
              ×
            </button>
          )}
        </li>
      ))}

      {theme && (
        <li className="file-tree-item file-tree-theme">
          <button
            type="button"
            className={`file-tree-button${theme === activePath ? ' is-active' : ''}`}
            onClick={() => onSelect(theme)}
            title={theme}
          >
            {basename(theme)}
          </button>
          <span className="file-tree-badge">theme</span>
        </li>
      )}
    </ul>
  );
}
