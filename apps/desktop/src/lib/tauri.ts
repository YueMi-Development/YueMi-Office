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

/**
 * The reason a call failed, as text.
 *
 * The shell rejects a call with the plain value the command gave back, not
 * with an Error, so a check of `instanceof Error` is never true and the
 * reason is lost. The reason is taken from whichever of the two shapes
 * arrives, and the fallback is used when neither carries one.
 */
export function reasonOf(caught: unknown, fallback: string): string {
  if (typeof caught === 'string' && caught.trim().length > 0) {
    return caught;
  }
  if (caught instanceof Error && caught.message.trim().length > 0) {
    return caught.message;
  }
  return fallback;
}
