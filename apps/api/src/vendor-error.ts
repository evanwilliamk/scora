// A failed vendor HTTP call (OpenAI, Oura), as thrown and logged: a fixed
// label plus the HTTP status, never the response body. A vendor's error body
// can echo the prompt or request (athlete values, tokens), so it is discarded
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
