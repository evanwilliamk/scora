// A stand-in for supabase-js's query builder: records every chained call per
// query and resolves each query with the next queued result. Lets tests pin
// the exact filters the production stores send (no network, no project).

export type Call = [method: string, ...args: unknown[]];

export function fakeSupabase(results: { data?: unknown; error?: { message: string } | null }[] = []) {
  const queries: { table: string; calls: Call[] }[] = [];
  const next = () => results.shift() ?? { data: null, error: null };
  const builder = (q: { table: string; calls: Call[] }): any =>
    new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') {
          const r = next();
          return (resolve: (v: unknown) => void) => resolve({ data: r.data ?? null, error: r.error ?? null });
        }
        return (...args: unknown[]) => { q.calls.push([prop, ...args]); return builder(q); };
      },
    });
  return {
    queries,
    from(table: string) {
      const q = { table, calls: [] as Call[] };
      queries.push(q);
      return builder(q);
    },
    rpc: async (fn: string, args: unknown) => { queries.push({ table: `rpc:${fn}`, calls: [['rpc', args]] }); const r = next(); return { data: r.data ?? null, error: r.error ?? null }; },
  };
}
