// Collects the voice_emission telemetry lines a route writes through the
// app's logger while `run` is awaited, then puts the logger back. For the
// gate 1.1.4 checks: one line per athlete-facing emission, never zero or two.

export async function emissionsDuring<T>(log: any, run: () => T): Promise<{ result: Awaited<T>; emissions: any[] }> {
  const real = log.info;
  const emissions: any[] = [];
  log.info = function (this: unknown, ...args: any[]) {
    const m = args.find((a) => typeof a === 'string');
    if (typeof m === 'string' && m.startsWith('telemetry ') && m.includes('"voice_emission"')) emissions.push(JSON.parse(m.slice('telemetry '.length)));
    return real.apply(this, args);
  };
  try {
    return { result: await run(), emissions };
  } finally {
    log.info = real;
  }
}
