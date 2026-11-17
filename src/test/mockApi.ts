import { vi } from 'vitest';

/** One recorded request to the mocked API. */
export interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  form?: FormData;
}
type Reply = { status?: number; body?: unknown };
type Handler = Reply | ((call: Call, params: Record<string, string>) => Reply | Promise<Reply>);

/**
 * Replaces fetch with a router keyed by "METHOD /api/path" (":name" matches one path segment).
 * Components run against the real API client (src/lib/api.ts); only the network is faked.
 * Unmatched requests answer 404 in the API's error format, so a missing mock fails loudly.
 */
export function mockApi(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const compiled = Object.entries(routes).map(([key, handler]) => {
    const [method, pattern] = key.split(' ');
    const names: string[] = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)'))}$`);
    return { method, re, names, handler };
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const form = init?.body instanceof FormData ? init.body : undefined;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const call: Call = { method, path: url.pathname, query: url.searchParams, body, form };
    calls.push(call);
    for (const r of compiled) {
      const m = r.method === method ? r.re.exec(url.pathname) : null;
      if (!m) continue;
      const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      const reply = typeof r.handler === 'function' ? await r.handler(call, params) : r.handler;
      const status = reply.status ?? 200;
      return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: { code: 'not_found', message: `No mock for ${method} ${url.pathname}` } }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    fetchMock,
    /** requests whose "METHOD path" starts with the given prefix */
    to: (prefix: string) => calls.filter((c) => `${c.method} ${c.path}`.startsWith(prefix)),
  };
}

export const apiError = (status: number, code: string, message: string, fields?: Record<string, string>): Reply => ({
  status,
  body: { error: { code, message, ...(fields ? { fields } : {}) } },
});

/** Last element (the web tsconfig targets ES2020, which has no Array.prototype.at). */
export const last = <T,>(items: T[]): T => items[items.length - 1];
