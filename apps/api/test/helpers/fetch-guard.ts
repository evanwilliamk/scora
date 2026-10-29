// Replaces global fetch for a test file: 127.0.0.1 passes through (the fake
// Supabase REST server), Strava, Oura and OpenAI get canned answers, and
// any other host throws. Nothing a route does can leave the machine.

export interface GuardCall {
  host: string;
  url: string;
  init?: RequestInit;
  body: any;
}

type Answer = { status?: number; body?: unknown };

export interface FetchGuard {
  calls: GuardCall[];
  // Strava activity list for the next activities request(s); sticky.
  stravaActivities(list: unknown[]): void;
  // Queue OpenAI chat replies (message content), used in order.
  openAi(...replies: (string | Answer)[]): void;
  reset(): void;
  restore(): void;
}

export function installFetchGuard(): FetchGuard {
  const real = globalThis.fetch;
  const calls: GuardCall[] = [];
  let activities: unknown[] = [];
  let llm: (string | Answer)[] = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(url);
    if (u.hostname === '127.0.0.1') return real(input, init);
    let body: any = null;
    try { body = typeof init?.body === 'string' ? JSON.parse(init.body) : null; } catch { body = init?.body; }
    calls.push({ host: u.hostname, url, init, body });
    if (u.hostname === 'www.strava.com' && u.pathname === '/api/v3/athlete/activities') {
      return json(200, Number(u.searchParams.get('page') ?? '1') > 1 ? [] : activities);
    }
    if (u.hostname === 'api.ouraring.com') return json(401, { detail: 'not connected in tests' });
    if (u.hostname === 'api.openai.com' && u.pathname === '/v1/chat/completions') {
      const next = llm.shift();
      if (next === undefined) return json(500, { error: { message: 'no canned reply queued' } });
      if (typeof next !== 'string') return json(next.status ?? 200, next.body ?? {});
      return json(200, { choices: [{ message: { role: 'assistant', content: next } }] });
    }
    throw new Error(`fetch-guard: blocked request to ${u.hostname}`);
  }) as typeof fetch;

  return {
    calls,
    stravaActivities(list) { activities = list; },
    openAi(...replies) { llm.push(...replies); },
    reset() { calls.length = 0; llm = []; activities = []; },
    restore() { globalThis.fetch = real; },
  };
}
