import { useMemo } from 'react';
import type { OutlineEntry } from '@yuemi/protocol';

export interface OutlineProps {
  entries: OutlineEntry[];
  pageCount: number;
  onSelect?: (entry: OutlineEntry) => void;
}

interface OutlineNode {
  entry: OutlineEntry;
  index: number;
  children: OutlineNode[];
}

function buildTree(entries: OutlineEntry[]): OutlineNode[] {
  const nodes = entries.map((entry, index) => ({
    entry,
    index,
    children: [] as OutlineNode[],
  }));

  const roots: OutlineNode[] = [];

  for (const node of nodes) {
    let parent: OutlineNode | undefined;
    for (const candidate of roots) {
      // The parent is the closest preceding node with a shallower level.
      if (candidate.entry.level < node.entry.level) {
        parent = candidate;
      }
    }
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function Outline({ entries, pageCount, onSelect }: OutlineProps) {
  const tree = useMemo(() => buildTree(entries), [entries]);

  if (entries.length === 0) {
    return (
      <div className="outline-empty">
        {pageCount > 0
          ? 'No headings in this document.'
          : 'The preview will appear once the document is rendered.'}
      </div>
    );
  }

  const renderNode = (node: OutlineNode): React.ReactNode => (
    <li key={node.index} className="outline-item">
      <button
        type="button"
        className="outline-entry"
        style={{ paddingLeft: `${(node.entry.level - 1) * 12 + 8}px` }}
        onClick={() => onSelect?.(node.entry)}
        title={node.entry.title}
      >
        <span className="outline-title">{node.entry.title}</span>
        <span className="outline-page">{node.entry.page + 1}</span>
      </button>
      {node.children.length > 0 && (
        <ul className="outline-children">{node.children.map(renderNode)}</ul>
      )}
    </li>
  );

  return <ul className="outline-list">{tree.map(renderNode)}</ul>;
}
