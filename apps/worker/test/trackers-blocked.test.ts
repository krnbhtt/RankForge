import { describe, expect, it } from 'vitest';
import { BlockedSiteError } from '@rankforge/schema';
import { isSameSite, isTrackerUrl } from '../src/capture/trackers.js';
import { assertNotBlocked } from '../src/capture/blocked.js';

describe('isTrackerUrl', () => {
  it.each([
    'https://www.googletagmanager.com/gtm.js?id=GTM-1',
    'https://www.google-analytics.com/g/collect?v=2',
    'https://connect.facebook.net/en_US/fbevents.js',
    'https://analytics.tiktok.com/i18n/pixel/events.js',
    'https://static.hotjar.com/c/hotjar-1.js',
    'https://www.clarity.ms/tag/abc',
    'https://static.klaviyo.com/onsite/js/klaviyo.js',
    'https://store.example.org/gtag/js?id=G-1',
  ])('blocks %s', (u) => expect(isTrackerUrl(u)).toBe(true));

  it.each([
    'https://cdn.shopify.com/s/files/1/theme.css',
    'https://store.example.org/products/x.js',
    'https://fonts.gstatic.com/s/inter.woff2',
    'not a url',
  ])('allows %s', (u) => expect(isTrackerUrl(u)).toBe(false));
});

describe('isSameSite', () => {
  it('matches the store domain and its subdomains, ignoring www', () => {
    expect(isSameSite('https://checkout.shop.example.org/cart', 'https://www.shop.example.org/p/1')).toBe(true);
    expect(isSameSite('https://shop.example.org/cart/add', 'https://www.shop.example.org/p/1')).toBe(true);
    expect(isSameSite('https://api.other.com/x', 'https://shop.example.org/p/1')).toBe(false);
  });
});

describe('assertNotBlocked', () => {
  const longText = 5000;
  it('passes a normal page', () => {
    expect(() =>
      assertNotBlocked({ status: 200, html: '<html>' + 'x'.repeat(500), title: 'Product', visibleTextLength: longText })
    ).not.toThrow();
  });

  it.each([403, 429, 401, 503])('throws BlockedSiteError for HTTP %i', (status) => {
    expect(() => assertNotBlocked({ status, html: '<html>x', title: 't', visibleTextLength: 10 })).toThrow(
      BlockedSiteError
    );
  });

  it('throws for an empty body', () => {
    expect(() => assertNotBlocked({ status: 200, html: '', title: '', visibleTextLength: 0 })).toThrow(/no content/);
    expect(() => assertNotBlocked({ status: 200, html: '<html></html>', title: '', visibleTextLength: 0 })).toThrow(
      BlockedSiteError
    );
  });

  it('throws for a Cloudflare challenge page', () => {
    expect(() =>
      assertNotBlocked({
        status: 200,
        html: '<html><div id="cf-browser-verification"></div>',
        title: 'Just a moment...',
        visibleTextLength: 120,
      })
    ).toThrow(/bot-check/);
  });

  it('flags a short continue-shopping interstitial (soft block)', () => {
    expect(() =>
      assertNotBlocked({
        status: 200,
        html: '<html><body>Click the button below to continue shopping</body></html>',
        title: 'Amazon.com',
        visibleTextLength: 120,
      })
    ).toThrow(/bot-check/);
  });

  it('does not flag a long real page that merely embeds a captcha script', () => {
    expect(() =>
      assertNotBlocked({
        status: 200,
        html: '<html><script src="https://www.google.com/recaptcha/g-recaptcha.js"></script>',
        title: 'Blue Mug',
        visibleTextLength: 6000,
      })
    ).not.toThrow();
  });

  it('exposes a recovery action pointing to HTML paste', () => {
    try {
      assertNotBlocked({ status: 403, html: 'x', title: '', visibleTextLength: 1 });
    } catch (e) {
      expect((e as BlockedSiteError).recoveryAction).toMatch(/Paste/);
    }
  });
});
