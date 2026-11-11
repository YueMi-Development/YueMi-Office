import { useMemo } from 'react';
import type { RenderWarning } from '@yuemi/protocol';

export interface WarningsPanelProps {
  warnings: RenderWarning[];
  /** Opens the file a warning refers to. */
  onOpenFile: (path: string) => void;
}

/**
 * A short label for each kind of warning.
 */
const WARNING_TITLES: Record<string, string> = {
  'layout.overflow': 'Content does not fit',
  'heading.orphan': 'Heading left alone on a page',
  'font.unresolved': 'Font not bundled',
  'font.missing': 'Font file missing',
  'asset.missing': 'File not found',
  'content.missing': 'Content file not found',
  'css.unsupported': 'Stylesheet not fully supported',
  'python.warning': 'Renderer warning',
  'render.warning': 'Renderer warning',
};

interface WarningGroup {
  code: string;
  title: string;
  warnings: RenderWarning[];
}

/**
 * Groups the warnings by kind, so a document with twenty problems of the
 * same kind reads as one problem with twenty instances.
 */
export function groupWarnings(warnings: RenderWarning[]): WarningGroup[] {
  const groups = new Map<string, RenderWarning[]>();

  for (const warning of warnings) {
    const existing = groups.get(warning.code);
    if (existing) {
      existing.push(warning);
    } else {
      groups.set(warning.code, [warning]);
    }
  }

  return [...groups.entries()].map(([code, entries]) => ({
    code,
    title: WARNING_TITLES[code] ?? code,
    warnings: entries,
  }));
}

/**
 * The list of problems the renderer found in the document.
 */
export function WarningsPanel({ warnings, onOpenFile }: WarningsPanelProps) {
  const groups = useMemo(() => groupWarnings(warnings), [warnings]);

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="warnings-panel" role="status">
      {groups.map((group) => (
        <section key={group.code} className="warnings-group">
          <h3 className="warnings-group-title">
            {group.title}
            {group.warnings.length > 1 && (
              <span className="warnings-count">{group.warnings.length}</span>
            )}
          </h3>
          <ul className="warnings-list">
            {group.warnings.map((warning, index) => (
              <li key={`${warning.code}-${warning.path ?? ''}-${index}`}>
                {warning.path ? (
                  <button
                    type="button"
                    className="warnings-path"
                    onClick={() => onOpenFile(warning.path as string)}
                    title={`Open ${warning.path}`}
                  >
                    {warning.path}
                  </button>
                ) : null}
                <span className="warnings-message">{warning.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
