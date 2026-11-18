import { unavailable } from './errors.js';

function origin(value: string | undefined, production: boolean): string {
  let u: URL;
  try {
    u = new URL(value ?? '');
  } catch {
    throw unavailable();
  }
  const local = !production && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (
    !(u.protocol === 'https:' || (local && u.protocol === 'http:')) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== '/'
  )
    throw unavailable();
  return u.origin;
}
export function readConfig(env: NodeJS.ProcessEnv) {
  // A publishable key identifies the app. No service key or admin API is needed by this server.
  const key = env.SUPABASE_PUBLISHABLE_KEY ?? '';
  let isAnon = false;
  if (key.split('.').length === 3) {
    try {
      isAnon = JSON.parse(Buffer.from(key.split('.')[1]!, 'base64url').toString()).role === 'anon';
    } catch {
      /* Not a legacy anon key. */
    }
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) && !isAnon) throw unavailable();
  for (const [name, value] of Object.entries(env)) {
    if (
      value &&
      /^(NEXT_PUBLIC_|PUBLIC_|VITE_).*(SECRET|SERVICE_ROLE|PASSWORD|PRIVATE_KEY|ACCESS_TOKEN|OPENAI_API_KEY)/i.test(
        name,
      )
    )
      throw unavailable();
  }
  const hosted = env.NODE_ENV === 'production' || env.VERCEL === '1';
  return {
    supabase: origin(env.SUPABASE_URL, hosted),
    key,
    origin: origin(env.API_ORIGIN, hosted),
  };
}
export type Config = ReturnType<typeof readConfig>;
