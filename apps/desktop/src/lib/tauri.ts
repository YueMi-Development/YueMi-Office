/**
 * Whether the app is running inside the Tauri shell.
 *
 * The frontend is also opened directly in a browser during development, and
 * in that case there is no filesystem access.
 */
export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}
