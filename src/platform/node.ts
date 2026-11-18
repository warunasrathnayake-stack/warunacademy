import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { createHandler } from './http.js';
import { readConfig } from './config.js';
import { SupabaseGateway } from './supabase.js';
let runtime: { db: SupabaseGateway; origin: string } | undefined;
const handle = createHandler(() => {
  if (!runtime) {
    const c = readConfig(process.env);
    runtime = { db: new SupabaseGateway(c), origin: c.origin };
  }
  return runtime;
});
export default async function nodeHandler(req: IncomingMessage, res: ServerResponse) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers))
    if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const hasBody =
    req.method !== 'GET' &&
    req.method !== 'HEAD' &&
    (Number(headers.get('content-length')) > 0 || headers.has('transfer-encoding'));
  const init: RequestInit & { duplex?: 'half' } = { method: req.method, headers };
  if (hasBody) {
    init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
    init.duplex = 'half';
  }
  const response = await handle(
    new Request(new URL(req.url ?? '/', 'http://api.internal'), init),
    req.socket.remoteAddress,
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}
