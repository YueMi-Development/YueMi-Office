import { describe, expect, it } from 'vitest';

import { SERVICE_PORT } from '@yuemi/protocol';

import {
  DEFAULT_SERVICE_URL,
  normalizeServiceUrl,
  validateServiceUrl,
} from '../lib/serviceUrl';

const URL = `http://127.0.0.1:${SERVICE_PORT}`;

describe('normalizeServiceUrl', () => {
  it('leaves a full address alone', () => {
    expect(normalizeServiceUrl(URL)).toBe(URL);
  });

  it('gives a bare host a scheme', () => {
    expect(normalizeServiceUrl('localhost:8787')).toBe('http://localhost:8787');
  });

  it('drops a trailing slash', () => {
    expect(normalizeServiceUrl('http://example.com/')).toBe('http://example.com');
  });

  it('falls back to the default for an empty value', () => {
    expect(normalizeServiceUrl('   ')).toBe(DEFAULT_SERVICE_URL);
  });
});

describe('validateServiceUrl', () => {
  it('accepts an http address', () => {
    expect(validateServiceUrl(URL)).toBeNull();
  });

  it('accepts an https address', () => {
    expect(validateServiceUrl('https://render.example.com')).toBeNull();
  });

  it('rejects an empty address', () => {
    expect(validateServiceUrl('')).toMatch(/Enter the address/);
  });

  it('rejects a scheme it cannot use', () => {
    expect(validateServiceUrl('ftp://example.com')).toMatch(/http/);
  });
});
