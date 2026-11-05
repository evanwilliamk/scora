// What a request that failed outside a route's own handling gets back. Fastify's
// default reply carries the error's message: a parser's quote of the body, or
// whatever an unexpected throw said (a host, a column, an env name). Fixed lines
// only; the error itself goes to the log.

// JSON bodies are small: a pasted plan is 8000 characters at most (48 KB if every
// one is escaped) and HealthKit nights are 35 short rows. /api/plan/ical sets its own.
export const BODY_LIMIT_BYTES = 128 * 1024;

export function publicError(err: { statusCode?: unknown }): { status: number; body: { error: string } } {
  const status = err?.statusCode;
  if (typeof status !== 'number' || status < 400 || status >= 500) {
    return { status: 500, body: { error: 'Something went wrong.' } };
  }
  const error = status === 413 ? 'The request is too large.'
    : status === 415 ? 'This content type is not accepted.'
    : 'The request could not be read.';
  return { status, body: { error } };
}
