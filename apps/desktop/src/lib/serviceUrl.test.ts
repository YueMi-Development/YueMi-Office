import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SERVICE_URL,
  normalizeServiceUrl,
  validateServiceUrl,
} from '../lib/serviceUrl';

describe('normalizeServiceUrl', () => {
  it('leaves a full address alone', () => {
    expect(normalizeServiceUrl('http://127.0.0.1:8000')).toBe(
      'http://127.0.0.1:8000',
    );
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
    expect(validateServiceUrl('http://127.0.0.1:8000')).toBeNull();
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
