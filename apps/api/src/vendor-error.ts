// A failed vendor HTTP call (OpenAI, Oura, the Strava token exchange), as
// thrown and logged: a fixed label plus the HTTP status, never the response
// body. A vendor's error body can echo the prompt or request (athlete
// values, tokens), so it is discarded
// unread (gate 1.1.6, no PHI in logs).

export class VendorHttpError extends Error {
  constructor(readonly label: string, readonly status: number) {
    super(`${label} ${status}`);
    this.name = 'VendorHttpError';
  }
}

// Drop the body without reading it and return the error to throw.
export async function vendorHttpError(res: { status: number; body?: ReadableStream | null }, label: string): Promise<VendorHttpError> {
  await res.body?.cancel().catch(() => {});
  return new VendorHttpError(label, res.status);
}

// What kind of failure, for logs: a fixed category, never an error message.
export function vendorErrorKind(e: unknown): string {
  if (e instanceof VendorHttpError) return `http_${e.status}`;
  if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'timeout';
  if (e instanceof TypeError) return 'network';
  return 'error';
}

// What a failed Strava or Oura pull says to the athlete, from the same
// categories: a 401 or 403 (after the token refresh already ran) means the
// connection has to be made again; anything else (timeout, network, 5xx, a
// body that is not a list) is the vendor not answering, which a retry can fix.
// Full sentences ending in a full stop, so the app shows them as they are.
export type VendorName = 'Strava' | 'Oura';

export function vendorNeedsReconnect(e: unknown): boolean {
  return e instanceof VendorHttpError && (e.status === 401 || e.status === 403);
}

export function vendorFailureLine(vendor: VendorName, e: unknown): string {
  return vendorNeedsReconnect(e) ? `${vendor} needs to be connected again.` : `${vendor} is not answering right now.`;
}
