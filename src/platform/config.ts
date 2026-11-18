import { unavailable } from './errors.js';

// This branch is authorized for one hosted development tenant. Never forward user JWTs
// to another HTTPS host merely because SUPABASE_URL was set. Project refs are not secrets.
export const devProjectRef = 'visphgkumgwnrajatidh';
export const devSupabaseOrigin = `https://${devProjectRef}.supabase.co`;
const loopback = (u: URL) => ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);

function origin(value: string | undefined, production: boolean): URL {
  let u: URL;
  try {
    u = new URL(value ?? '');
  } catch {
    throw unavailable();
  }
  const local = !production && loopback(u);
  if (
    !(u.protocol === 'https:' || (local && u.protocol === 'http:')) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== '/'
  )
    throw unavailable();
  return u;
}
// Classify legacy *configuration*, never authenticate a user by decoding their JWT.
function legacyRole(value: string): unknown {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return;
  try {
    return JSON.parse(Buffer.from(value.split('.')[1]!, 'base64url').toString())?.role;
  } catch {
    return;
  }
}
export function readConfig(env: NodeJS.ProcessEnv) {
  const key = env.SUPABASE_PUBLISHABLE_KEY ?? '';
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) && legacyRole(key) !== 'anon')
    throw unavailable();
  // Keep operator credentials out of the runtime, even if they were injected alongside a valid key.
  for (const name of [
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_ACCESS_TOKEN',
    'SUPABASE_DB_PASSWORD',
  ])
    if (env[name]) throw unavailable();
  for (const [name, value] of Object.entries(env)) {
    if (!value || !/^(NEXT_PUBLIC_|PUBLIC_|VITE_)/i.test(name)) continue;
    if (
      /SECRET|SERVICE_ROLE|PASSWORD|PRIVATE_KEY|ACCESS_TOKEN|OPENAI_API_KEY/i.test(name) ||
      value.startsWith('sb_secret_') ||
      value.startsWith('sbp_') ||
      legacyRole(value) === 'service_role'
    )
      throw unavailable();
  }
  const hosted = env.NODE_ENV === 'production' || env.VERCEL === '1';
  const supabase = origin(env.SUPABASE_URL, hosted);
  if (supabase.origin !== devSupabaseOrigin && (hosted || !loopback(supabase))) throw unavailable();
  return { supabase: supabase.origin, key, origin: origin(env.API_ORIGIN, hosted).origin };
}
export type Config = ReturnType<typeof readConfig>;
