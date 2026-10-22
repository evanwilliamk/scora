// A stand-in for supabase-js's query builder: records every chained call per
// query and resolves it with a queued result. Each query takes its result
// when from() creates it, so the order of awaits does not matter, and
// awaiting a query twice returns the same result. Only real builder methods
// exist, so a typo in production code fails here too. Filters are recorded,
// not applied: tests assert on them.

export type Call = [method: string, ...args: unknown[]];
type Result = { data?: unknown; error?: { message: string } | null };

const METHODS = new Set([
  'select', 'insert', 'upsert', 'update', 'delete',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'or', 'not', 'match', 'filter',
  'order', 'limit', 'range', 'single', 'maybeSingle',
]);

export function fakeSupabase(results: Result[] = []) {
  const queries: { table: string; calls: Call[] }[] = [];
  const take = () => results.shift() ?? { data: null, error: null };
  const builder = (q: { table: string; calls: Call[] }, r: Result): any =>
    new Proxy({}, {
      get(_t, prop: string | symbol) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve({ data: r.data ?? null, error: r.error ?? null });
        }
        if (typeof prop !== 'string' || !METHODS.has(prop)) {
          throw new Error(`fake supabase: no builder method "${String(prop)}"`);
        }
        return (...args: unknown[]) => { q.calls.push([prop, ...args]); return builder(q, r); };
      },
    });
  return {
    queries,
    from(table: string) {
      const q = { table, calls: [] as Call[] };
      queries.push(q);
      return builder(q, take());
    },
    rpc: async (fn: string, args: unknown) => {
      queries.push({ table: `rpc:${fn}`, calls: [['rpc', args]] });
      const r = take();
      return { data: r.data ?? null, error: r.error ?? null };
    },
  };
}
