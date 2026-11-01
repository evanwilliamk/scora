// Run independent I/O side by side without changing what a failure does.
//
// settle() starts the call now and never rejects: the caller reads the
// outcome later, at the point the sequential code used to await it, and logs
// or falls back there. So a failure is reported in the same place, with the
// same message, and a result nobody reads (an early return) is never an
// unhandled rejection. A synchronous throw (a missing env var) is caught too.

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

export function settle<T>(call: () => Promise<T>): Promise<Settled<T>> {
  return (async () => call())().then(
    (value): Settled<T> => ({ ok: true, value }),
    (error): Settled<T> => ({ ok: false, error })
  );
}

// The settled value, or the original error thrown again.
export function unwrap<T>(s: Settled<T>): T {
  if (s.ok) return s.value;
  throw s.error;
}
