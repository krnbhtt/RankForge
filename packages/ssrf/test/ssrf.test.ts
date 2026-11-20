import { describe, expect, it } from 'vitest';
import { SsrfBlockedError, isPrivateIp, safeFetch, validateTargetUrl } from '../src/index.js';

const publicResolver = async () => ['93.184.216.34'];

describe('isPrivateIp', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:a9fe:a9fe',
    '64:ff9b::7f00:1',
    '2002:a9fe:a9fe::',
  ])('blocks %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:2800:220:1:248:1893:25c8:1946'])(
    'allows %s',
    (ip) => {
      expect(isPrivateIp(ip)).toBe(false);
    }
  );
});

describe('validateTargetUrl', () => {
  it('accepts a public https URL', async () => {
    const r = await validateTargetUrl('https://shop.example.org/products/x', { resolver: publicResolver });
    expect(r.isValid).toBe(true);
    expect(r.resolvedIp).toBe('93.184.216.34');
  });

  it.each(['ftp://a.com/x', 'file:///etc/passwd', 'javascript:alert(1)', 'gopher://a.com'])(
    'rejects non-http scheme %s',
    async (url) => {
      expect((await validateTargetUrl(url, { resolver: publicResolver })).isValid).toBe(false);
    }
  );

  it.each([
    'http://localhost/x',
    'http://app.localhost/x',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::ffff:169.254.169.254]/',
    'http://127.0.0.1:8080/',
    'http://10.0.0.5/',
    'http://user:pass@shop.example.org/',
  ])('rejects %s', async (url) => {
    expect((await validateTargetUrl(url, { resolver: publicResolver })).isValid).toBe(false);
  });

  it('rejects a hostname whose DNS answer includes any private address', async () => {
    const r = await validateTargetUrl('https://rebind.example.org/', {
      resolver: async () => ['93.184.216.34', '10.0.0.7'],
    });
    expect(r.isValid).toBe(false);
    expect(r.error).toContain('10.0.0.7');
  });

  it('fails closed when DNS resolution fails, with no example.com exemption', async () => {
    const r = await validateTargetUrl('https://example.com/p', {
      resolver: async () => {
        throw new Error('ENOTFOUND');
      },
    });
    expect(r.isValid).toBe(false);
  });
});

describe('safeFetch', () => {
  function redirectingFetch(chain: Record<string, string | null>): typeof fetch {
    return (async (input: string | URL | Request) => {
      const url = String(input);
      const next = chain[url];
      if (next) {
        return new Response(null, { status: 302, headers: { location: next } });
      }
      return new Response('ok', { status: 200 });
    }) as typeof fetch;
  }

  it('follows public redirects', async () => {
    const res = await safeFetch('https://a.example.org/', {
      resolver: publicResolver,
      fetchImpl: redirectingFetch({ 'https://a.example.org/': 'https://b.example.org/p' }),
    });
    expect(await res.text()).toBe('ok');
  });

  it('blocks a redirect from a public host to the metadata server', async () => {
    await expect(
      safeFetch('https://a.example.org/', {
        resolver: publicResolver,
        fetchImpl: redirectingFetch({ 'https://a.example.org/': 'http://169.254.169.254/latest/' }),
      })
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('blocks a redirect to a hostname that resolves privately on the second hop', async () => {
    const resolver = async (host: string) => (host === 'evil.example.org' ? ['192.168.1.9'] : ['93.184.216.34']);
    await expect(
      safeFetch('https://a.example.org/', {
        resolver,
        fetchImpl: redirectingFetch({ 'https://a.example.org/': 'https://evil.example.org/' }),
      })
    ).rejects.toThrow(/private IP/);
  });

  it('stops after too many redirects', async () => {
    await expect(
      safeFetch('https://a.example.org/', {
        resolver: publicResolver,
        maxRedirects: 2,
        fetchImpl: redirectingFetch({ 'https://a.example.org/': 'https://a.example.org/' }),
      })
    ).rejects.toThrow(/Too many redirects/);
  });
});
