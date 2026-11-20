export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  auditId?: string;
  stage?: string;
  durationMs?: number;
  [key: string]: unknown;
}

export type Logger = (level: LogLevel, msg: string, fields?: LogFields) => void;

/** Structured JSON logger: one line per event, stdout for info and below, stderr for warn/error. */
export const log: Logger = (level, msg, fields = {}) => {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === 'warn' || level === 'error') {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
};

export const silentLog: Logger = () => undefined;

/** Times an async step and logs its duration under the given stage. */
export async function timed<T>(
  logger: Logger,
  auditId: string,
  stage: string,
  fn: () => Promise<T>
): Promise<{ value: T; durationMs: number }> {
  const start = Date.now();
  try {
    const value = await fn();
    const durationMs = Date.now() - start;
    logger('info', `${stage} done`, { auditId, stage, durationMs });
    return { value, durationMs };
  } catch (err) {
    logger('error', `${stage} failed`, {
      auditId,
      stage,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
