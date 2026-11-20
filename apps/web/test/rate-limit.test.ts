import { describe, expect, it } from 'vitest';
import { AuditRateLimiter } from '../lib/rate-limit';

function limiter(over: Partial<ConstructorParameters<typeof AuditRateLimiter>[0]> = {}) {
  let t = 1_000_000;
  const l = new AuditRateLimiter({ burst: 3, windowMs: 60_000, maxConcurrent: 2, now: () => t, ...over });
  return { l, advance: (ms: number) => (t += ms) };
}

describe('AuditRateLimiter', () => {
  it('allows a burst, then asks the client to wait', () => {
    const { l } = limiter({ maxConcurrent: 10 });
    expect(l.tryAcquire('a', '1').allowed).toBe(true);
    expect(l.tryAcquire('a', '2').allowed).toBe(true);
    expect(l.tryAcquire('a', '3').allowed).toBe(true);
    const blocked = l.tryAcquire('a', '4');
    expect(blocked).toMatchObject({ allowed: false, reason: 'rate' });
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('refills tokens over time and tracks clients separately', () => {
    const { l, advance } = limiter({ maxConcurrent: 10 });
    for (const id of ['1', '2', '3']) l.tryAcquire('a', id);
    expect(l.tryAcquire('a', '4').allowed).toBe(false);
    expect(l.tryAcquire('b', '5').allowed).toBe(true);
    advance(25_000);
    expect(l.tryAcquire('a', '6').allowed).toBe(true);
  });

  it('caps concurrently running audits and frees a slot on release', () => {
    const { l } = limiter({ burst: 10 });
    expect(l.tryAcquire('a', '1').allowed).toBe(true);
    expect(l.tryAcquire('b', '2').allowed).toBe(true);
    expect(l.tryAcquire('c', '3')).toMatchObject({ allowed: false, reason: 'busy' });
    l.release('1');
    expect(l.runningCount).toBe(1);
    expect(l.tryAcquire('c', '3').allowed).toBe(true);
  });

  it('does not spend a token when the studio is busy', () => {
    const { l } = limiter({ burst: 2, maxConcurrent: 1 });
    expect(l.tryAcquire('a', '1').allowed).toBe(true);
    expect(l.tryAcquire('a', '2')).toMatchObject({ allowed: false, reason: 'busy' });
    l.release('1');
    expect(l.tryAcquire('a', '3').allowed).toBe(true);
  });
});
