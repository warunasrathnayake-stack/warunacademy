import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { routes } from '../routes.js';
import { disabled, hasWebhook } from '../integrations/registry.js';
import { ApiError, unauthorized } from './errors.js';
import { MinuteLimiter } from './limiter.js';
import type { Gateway } from './supabase.js';

const MAX_BODY = 64 * 1024;
const prefix = '/api/v1';
const endpoints = routes.map((route) => ({
  route,
  pattern: new RegExp('^' + prefix + route.path.replace(/\{(\w+)\}/g, '(?<$1>[^/]+)') + '$'),
}));
async function jsonBody(request: Request) {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
  )
    throw new ApiError(415, 'json_required');
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY)
    throw new ApiError(413, 'body_too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'invalid_json');
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      count += part.value.byteLength;
      if (count > MAX_BODY) {
        await reader.cancel();
        throw new ApiError(413, 'body_too_large');
      }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks, count).toString('utf8'));
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, 'invalid_json');
  } finally {
    reader.releaseLock();
  }
}
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError(422, 'invalid_input');
  return parsed.data;
}
export function createHandler(
  runtime: () => { db: Gateway; origin: string },
  ingress = new MinuteLimiter(360),
  actors = new MinuteLimiter(240),
) {
  return async (request: Request, peer = 'unknown'): Promise<Response> => {
    const requestId = randomUUID();
    const headers = new Headers({
      'cache-control': 'no-store',
      'x-request-id': requestId,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      vary: 'Authorization',
    });
    try {
      ingress.take(peer); // Transport peer only; never trust a caller-supplied forwarded-for header.
      const url = new URL(request.url);
      const webhook = /^\/api\/v1\/webhooks\/([^/]+)$/.exec(url.pathname);
      if (webhook && hasWebhook(webhook[1]!)) {
        if (request.method !== 'POST') {
          headers.set('allow', 'POST');
          throw new ApiError(405, 'method_not_allowed');
        }
        throw disabled(); // Do not ingest, log or positively acknowledge unverified events.
      }
      const matching = endpoints.filter((e) => e.pattern.test(url.pathname));
      if (!matching.length) throw new ApiError(404, 'not_found');
      const endpoint = matching.find((e) => e.route.method === request.method);
      if (!endpoint) {
        headers.set('allow', matching.map((e) => e.route.method).join(', '));
        throw new ApiError(405, 'method_not_allowed');
      }
      const { route, pattern } = endpoint;
      const auth = request.headers.get('authorization') ?? '';
      if (
        auth.length > 8192 ||
        !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(auth)
      )
        throw unauthorized();
      const { db, origin } = runtime();
      if (request.headers.has('origin') && request.headers.get('origin') !== origin)
        throw new ApiError(403, 'origin_denied');
      const token = auth.slice(7);
      const userId = await db.verify(token);
      actors.take(userId);
      const q: Record<string, string> = Object.create(null);
      for (const [k, v] of url.searchParams) {
        if (Object.hasOwn(q, k)) throw new ApiError(422, 'invalid_input');
        q[k] = v;
      }
      const params = parse(
        z.strictObject(route.params ?? {}),
        pattern.exec(url.pathname)?.groups ?? {},
      );
      const query = parse(z.strictObject(route.query ?? {}), q);
      const body = route.body ? parse(route.body, await jsonBody(request)) : {};
      if (!route.body && request.body) throw new ApiError(422, 'unexpected_body');
      const args = Object.fromEntries(
        Object.entries({ ...params, ...query, ...(body as Record<string, unknown>) }).map(
          ([k, v]) => ['p_' + k, k === 'offset' ? Number(v) : v],
        ),
      );
      let result: unknown;
      if (route.special === 'logout') {
        await db.logout(token);
        result = { signed_out: true };
      } else {
        result = await db.rpc(route.rpc!, args, token);
        if (route.rpc === 'me' && result === null) throw new ApiError(403, 'profile_required');
        if (route.special === 'resource') {
          const asset = z.object({ object_path: z.string() }).safeParse(result);
          if (!asset.success) throw new ApiError(502, 'invalid_upstream_response');
          result = await db.sign(asset.data.object_path, token);
        }
      }
      const checked = route.result.safeParse(result);
      if (!checked.success) throw new ApiError(502, 'invalid_upstream_response');
      return Response.json(
        { data: checked.data, request_id: requestId },
        { status: route.status ?? 200, headers },
      );
    } catch (cause) {
      const error = cause instanceof ApiError ? cause : new ApiError(500, 'internal_error');
      if (error.status === 429) headers.set('retry-after', '60');
      if (error.status === 401) headers.set('www-authenticate', 'Bearer');
      return Response.json(
        { error: { code: error.code, request_id: requestId } },
        { status: error.status, headers },
      );
    }
  };
}
