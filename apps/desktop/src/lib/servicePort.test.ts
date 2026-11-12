import { describe, expect, it } from 'vitest';

import ci from '../../../../.github/workflows/ci.yml?raw';
import dockerfile from '../../../../apps/api/Dockerfile?raw';
import compose from '../../../../apps/api/docker-compose.yml?raw';
import tauriConfig from '../../src-tauri/tauri.conf.json?raw';

import { SERVICE_PORT } from '@yuemi/protocol';

import { DEFAULT_SERVICE_URL } from './serviceUrl';

/**
 * The port the service listens on.
 *
 * The service, the image that runs it, the CI job that smoke-tests it and
 * the app that calls it all have to agree on the port. Nothing forces them
 * to, so every place that names it is checked here.
 *
 * The app's own copy is the shared contract, which is the one the service's
 * test compares itself against.
 */

/** The port as a number, wherever a file writes it. */
const PORT = String(SERVICE_PORT);

/**
 * The band the port has to sit in.
 *
 * It is above the ports software listens on by default and below the range
 * the operating system hands out to short-lived connections.
 */
const PORT_BAND = { low: 32000, high: 32767 };

/**
 * Ports that other software listens on by default.
 *
 * 8000 is the port every Python web framework is taught to use. 8123 is
 * Home Assistant's default web interface. Neither shows up in the IANA
 * registry in the way a server port usually does, so the registry is not
 * enough to find them.
 */
const COMMON_PORTS = [8000, 8123];

describe('the service port', () => {
  it('is where the app looks for the service by default', () => {
    expect(DEFAULT_SERVICE_URL).toBe(`http://127.0.0.1:${PORT}`);
  });

  it('is the port the image listens on', () => {
    expect(dockerfile).toContain(`EXPOSE ${PORT}`);
  });

  it('is the port the compose file publishes', () => {
    expect(compose).toContain(`"${PORT}:${PORT}"`);
  });

  it('is the port the app is allowed to connect to', () => {
    // The app's own content security policy, which decides which addresses
    // the webview may reach.
    expect(tauriConfig).toContain(`http://127.0.0.1:${PORT}`);
  });

  it('is the port the CI job smoke-tests the image on', () => {
    // The job reads the port from the service's code rather than naming it,
    // so what is checked here is that it reads it at all.
    expect(ci).toContain('SERVICE_PORT');
  });

  it('is not one that everything else on a machine takes', () => {
    for (const port of COMMON_PORTS) {
      expect(SERVICE_PORT).not.toBe(port);
    }
  });

  it('is above the ports software listens on by default', () => {
    expect(SERVICE_PORT).toBeGreaterThanOrEqual(PORT_BAND.low);
  });

  it('is below the range the operating system hands out', () => {
    // The operating system gives short-lived connections a port out of the
    // ephemeral range: from 49152 on Windows and macOS, from 32768 on
    // Linux. A service listening inside that range can have its own port
    // taken away from under it.
    expect(SERVICE_PORT).toBeLessThanOrEqual(PORT_BAND.high);
  });
});
