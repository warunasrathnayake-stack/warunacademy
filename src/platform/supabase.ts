import { z } from 'zod';
import type { Config } from './config.js';
import { ApiError, unauthorized } from './errors.js';

export interface Gateway {
  verify(token: string): Promise<string>;
  rpc(name: string, args: Record<string, unknown>, token: string): Promise<unknown>;
  sign(path: string, token: string): Promise<{ url: string; expires_in: number }>;
  logout(token: string): Promise<void>;
}
const upstream = () => new ApiError(502, 'upstream_error');
export class SupabaseGateway implements Gateway {
  constructor(
    private readonly config: Config,
    private readonly transport: typeof fetch = fetch,
  ) {}
  private async request(path: string, token: string, method: string, body?: unknown, rpc = false) {
    let response: Response;
    try {
      response = await this.transport(this.config.supabase + path, {
        method,
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
        headers: {
          apikey: this.config.key,
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...(rpc ? { 'Content-Profile': 'academy_api', 'Accept-Profile': 'academy_api' } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError(503, 'upstream_unavailable');
    }
    if (!response.ok) {
      if (response.status === 401) throw unauthorized();
      if (response.status === 429) throw new ApiError(429, 'rate_limited');
      const code = (await response.json().catch(() => ({})))?.code;
      if (code === '42501' || response.status === 403) throw new ApiError(403, 'forbidden');
      if (code === '23505') throw new ApiError(409, 'conflict');
      if (code === 'P0002') throw new ApiError(404, 'not_found');
      if (code === 'PT429') throw new ApiError(429, 'rate_limited');
      if (
        ['23502', '23503', '23514'].includes(code) ||
        (typeof code === 'string' && code.startsWith('22'))
      )
        throw new ApiError(422, 'invalid_input');
      throw upstream(); // Never relay SQL detail, signed URLs, provider messages or credentials.
    }
    return response;
  }
  async verify(token: string) {
    const response = await this.request('/auth/v1/user', token, 'GET');
    const user = await response.json().catch(() => null);
    if (!z.uuid().safeParse(user?.id).success || user?.is_anonymous || !user?.email_confirmed_at)
      throw unauthorized();
    return user.id as string;
  }
  async rpc(name: string, args: Record<string, unknown>, token: string) {
    return (await this.request(`/rest/v1/rpc/${name}`, token, 'POST', args, true))
      .json()
      .catch(() => {
        throw upstream();
      });
  }
  async sign(path: string, token: string) {
    if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.[a-z0-9]+$/.test(path)) throw upstream();
    const prefix = `/object/sign/academy-library/${path}`;
    const r = await this.request(`/storage/v1${prefix}`, token, 'POST', { expiresIn: 60 });
    const data = await r.json().catch(() => null);
    // The Storage API returns a relative signedURL. Never return a foreign origin or another file.
    if (typeof data?.signedURL !== 'string' || !data.signedURL.startsWith(`${prefix}?token=`))
      throw upstream();
    return { url: `${this.config.supabase}/storage/v1${data.signedURL}`, expires_in: 60 };
  }
  async logout(token: string) {
    await this.request('/auth/v1/logout?scope=local', token, 'POST');
  }
}
