export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  /** Return false to stop retrying for errors that cannot succeed on a second attempt. */
  shouldRetry?: (err: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `fn`, retrying with exponential backoff and full jitter. Throws the last error. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const maxDelay = options.maxDelayMs ?? 5000;
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === options.retries) break;
      if (options.shouldRetry && !options.shouldRetry(err)) break;
      const ceiling = Math.min(maxDelay, options.baseDelayMs * 2 ** attempt);
      await sleep(Math.floor(random() * ceiling));
    }
  }
  throw lastError;
}
