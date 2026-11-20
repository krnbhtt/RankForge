import { BlockedSiteError } from '@rankforge/schema';

const CHALLENGE_TITLES = [
  'just a moment',
  'attention required',
  'access denied',
  'pardon our interruption',
  'are you a robot',
  'verify you are human',
  'security check',
  'please wait while we verify',
  'request blocked',
];

const CHALLENGE_BODY_MARKERS = [
  'cf-browser-verification',
  'cf-challenge',
  'challenge-platform',
  'px-captcha',
  'captcha-delivery.com',
  'datadome',
  'g-recaptcha',
  'h-captcha',
  'akamai-bot',
  '_incapsula_',
  'distil_r_captcha',
];

/** A real product page has far more text than a challenge interstitial. */
const MIN_REAL_TEXT_LENGTH = 400;

export interface BlockCheckInput {
  status: number;
  html: string;
  title: string;
  visibleTextLength: number;
}

/**
 * Throws BlockedSiteError when the response looks like an access block: HTTP 403/429,
 * an empty body, or a bot-challenge page. Returns normally for usable pages.
 */
export function assertNotBlocked(input: BlockCheckInput): void {
  const { status, html, title, visibleTextLength } = input;

  if (status === 403 || status === 429 || status === 401) {
    throw new BlockedSiteError(`The site refused automated access (HTTP ${status}).`, 'http_status', { status });
  }
  if (status >= 500) {
    throw new BlockedSiteError(`The site returned a server error (HTTP ${status}).`, 'http_status', { status });
  }

  if (html.trim().length === 0 || visibleTextLength === 0) {
    throw new BlockedSiteError('The page returned no content.', 'empty_body', { status });
  }

  const lowerTitle = title.toLowerCase();
  const titleHit = CHALLENGE_TITLES.find((t) => lowerTitle.includes(t));
  const lowerHtml = html.toLowerCase();
  const bodyHit = CHALLENGE_BODY_MARKERS.find((m) => lowerHtml.includes(m));

  if (titleHit && visibleTextLength < MIN_REAL_TEXT_LENGTH * 4) {
    throw new BlockedSiteError('The site showed a bot-check page instead of the product.', 'challenge_page', {
      marker: titleHit,
    });
  }
  if (bodyHit && visibleTextLength < MIN_REAL_TEXT_LENGTH) {
    throw new BlockedSiteError('The site showed a bot-check page instead of the product.', 'challenge_page', {
      marker: bodyHit,
    });
  }
}
