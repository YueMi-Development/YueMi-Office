/**
 * The address of the render service.
 *
 * The service is hosted for v1 (PRD section 11), so the address is a setting
 * rather than a constant baked into the bundle. These helpers live on their
 * own so both the API module and the settings store can use them.
 */

/**
 * Where the render service lives by default.
 *
 * A local service is what the development setup uses; a packaged app reads
 * the address from its settings.
 */
export const DEFAULT_SERVICE_URL = 'http://127.0.0.1:8000';

/**
 * Turns what the user typed into a usable address.
 *
 * A bare host or port is given a scheme, and a trailing slash is dropped, so
 * that `localhost:8787` and `http://localhost:8787/` mean the same thing.
 */
export function normalizeServiceUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_SERVICE_URL;
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

/**
 * Checks that an address is one the app can actually talk to.
 *
 * Returns the problem in words rather than throwing, so the setting can show
 * it next to the field the user typed in.
 */
export function validateServiceUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Enter the address of the render service.';
  }

  let url: URL;
  try {
    url = new URL(normalizeServiceUrl(trimmed));
  } catch {
    return 'This is not a valid address.';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'The address must start with http:// or https://.';
  }

  if (!url.hostname) {
    return 'The address is missing a host name.';
  }

  return null;
}
