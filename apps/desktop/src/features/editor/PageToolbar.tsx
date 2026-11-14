export interface PageToolbarProps {
  /** The name of the file that is open. */
  fileName: string;
  /** The page the cursor is on, starting at zero. */
  pageIndex: number;
  /** How many pages the file has. */
  pageCount: number;
  /** Whether the open file can have pages added to it. */
  canEdit: boolean;
  /** Called when a page should be added. */
  onAddPage: () => void;
  /** Called when a page should be removed. */
  onRemovePage: () => void;
}

/**
 * The bar above the editor that says where the cursor is and what can be done
 * with the page it is on.
 *
 * The page is the part of the file between two page breaks. A file with a
 * single page has nothing to remove, so the remove button is off until there
 * is a second page.
 */
export function PageToolbar({
  fileName,
  pageIndex,
  pageCount,
  canEdit,
  onAddPage,
  onRemovePage,
}: PageToolbarProps) {
  return (
    <div className="editor-toolbar">
      <span className="editor-toolbar-file">{fileName}</span>

      <span className="editor-toolbar-info">
        Page {pageIndex + 1} of {pageCount}
      </span>

      <span className="editor-toolbar-actions">
        <button type="button" onClick={onAddPage} disabled={!canEdit}>
          Add page
        </button>
        <button
          type="button"
          onClick={onRemovePage}
          disabled={!canEdit || pageCount < 2}
        >
          Remove page
        </button>
      </span>
    </div>
  );
}
