import { create } from 'zustand';

export interface EditorState {
  /** The content file currently open in the editor. */
  activePath: string | null;
  /** The file the search box is scoped to, or null for all files. */
  searchQuery: string;
  /** Whether the search panel is open. */
  searchOpen: boolean;
  /** Paths of files that matched the last search. */
  searchResults: string[];

  setActivePath: (path: string | null) => void;
  setSearchQuery: (query: string) => void;
  setSearchOpen: (open: boolean) => void;
  setSearchResults: (paths: string[]) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  activePath: null,
  searchQuery: '',
  searchOpen: false,
  searchResults: [],

  setActivePath: (path) => set({ activePath: path }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setSearchResults: (paths) => set({ searchResults: paths }),
}));
