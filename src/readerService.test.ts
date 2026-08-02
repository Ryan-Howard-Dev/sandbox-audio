import { beforeEach, describe, expect, it } from 'vitest';
import {
  isReaderServiceConfigured,
  loadReaderServiceUrl,
  normaliseReaderBase,
  parseReaderPayload,
  readerRequestUrl,
  saveReaderServiceUrl,
} from './readerService';

describe('normaliseReaderBase', () => {
  it('drops a trailing slash so request building never doubles it', () => {
    expect(normaliseReaderBase('http://192.168.1.10:3000/')).toBe('http://192.168.1.10:3000');
    expect(normaliseReaderBase('http://192.168.1.10:3000///')).toBe('http://192.168.1.10:3000');
  });

  it('keeps a path, for an instance behind a reverse proxy', () => {
    expect(normaliseReaderBase('https://home.example/reader/')).toBe('https://home.example/reader');
  });

  it('rejects a bare host, which would resolve against the app origin', () => {
    expect(normaliseReaderBase('localhost:3000')).toBeNull();
  });

  it('rejects schemes that are not http', () => {
    expect(normaliseReaderBase('file:///etc/passwd')).toBeNull();
    expect(normaliseReaderBase('javascript:alert(1)')).toBeNull();
  });

  it('treats empty and whitespace as unset', () => {
    expect(normaliseReaderBase('')).toBeNull();
    expect(normaliseReaderBase('   ')).toBeNull();
  });
});

describe('readerRequestUrl', () => {
  it('appends the target whole, unencoded, because the service parses it as a URL', () => {
    expect(readerRequestUrl('http://server:3000', 'https://example.com/a/b?x=1')).toBe(
      'http://server:3000/https://example.com/a/b?x=1',
    );
  });

  it('drops the fragment, which never reaches a server and would truncate the request', () => {
    expect(readerRequestUrl('http://s:3000', 'https://example.com/p#section')).toBe(
      'http://s:3000/https://example.com/p',
    );
  });
});

describe('parseReaderPayload', () => {
  it('reads the documented JSON shape', () => {
    expect(
      parseReaderPayload({ code: 200, data: { title: 'Findings', content: '# Findings\n\nText.' } }),
    ).toEqual({ title: 'Findings', text: '# Findings\n\nText.' });
  });

  it('accepts markdown returned directly, for an instance that does not answer JSON', () => {
    expect(parseReaderPayload('# Heading\n\nBody.')).toEqual({
      title: '',
      text: '# Heading\n\nBody.',
    });
  });

  it('returns null when the service answered but found nothing', () => {
    expect(parseReaderPayload({ code: 200, data: { title: 'Empty', content: '   ' } })).toBeNull();
    expect(parseReaderPayload('')).toBeNull();
    expect(parseReaderPayload({ code: 422 })).toBeNull();
    expect(parseReaderPayload(null)).toBeNull();
  });
});

describe('the setting', () => {
  beforeEach(() => {
    saveReaderServiceUrl('');
  });

  it('is off until a URL is set, so nothing is sent anywhere by default', () => {
    expect(loadReaderServiceUrl()).toBe('');
    expect(isReaderServiceConfigured()).toBe(false);
  });

  it('round-trips a URL, normalised', () => {
    saveReaderServiceUrl('  http://192.168.1.10:3000/  ');
    expect(loadReaderServiceUrl()).toBe('http://192.168.1.10:3000');
    expect(isReaderServiceConfigured()).toBe(true);
  });

  it('clears back to off, so a bad address can be undone', () => {
    saveReaderServiceUrl('http://192.168.1.10:3000');
    saveReaderServiceUrl('');
    expect(isReaderServiceConfigured()).toBe(false);
  });

  it('does not store an address it could not make sense of', () => {
    saveReaderServiceUrl('not a url');
    expect(isReaderServiceConfigured()).toBe(false);
  });
});
