// A local stand-in for Supabase's REST endpoint (PostgREST), so route tests
// can drive the real handlers past their input checks without any service.
// Each request is recorded; the next queued answer for its table is sent,
// else an empty list. Listens on 127.0.0.1 only.

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RestRequest {
  method: string;
  table: string;
  params: URLSearchParams;
  body: any;
  headers: IncomingMessage['headers'];
}

export interface RestAnswer {
  status?: number;
  body?: unknown;
}

export interface FakeRest {
  url: string;
  requests: RestRequest[];
  // Queue answers for one table, used in order.
  answer(table: string, ...answers: RestAnswer[]): void;
  reset(): void;
  close(): Promise<void>;
}

export async function fakeRest(): Promise<FakeRest> {
  const requests: RestRequest[] = [];
  let queues = new Map<string, RestAnswer[]>();
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      const table = u.pathname.replace(/^\/rest\/v1\//, '');
      let body: any = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
      requests.push({ method: req.method ?? 'GET', table, params: u.searchParams, body, headers: req.headers });
      const next = queues.get(table)?.shift() ?? {};
      let out = next.body ?? [];
      // .single() / .maybeSingle() ask for one object.
      if (String(req.headers.accept ?? '').includes('vnd.pgrst.object') && Array.isArray(out)) {
        if (out.length !== 1) {
          res.writeHead(406, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `${out.length} rows`, hint: null }));
          return;
        }
        out = out[0];
      }
      res.writeHead(next.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    answer(table, ...answers) {
      queues.set(table, [...(queues.get(table) ?? []), ...answers]);
    },
    reset() {
      requests.length = 0;
      queues = new Map();
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
