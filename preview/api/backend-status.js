// Read-only connectivity probe for the existing Waruna Supabase development tenant.
// No credentials, user records, database mutations, or academy RPC calls.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') return res.status(405).json({ status: 'method_not_allowed' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch('https://visphgkumgwnrajatidh.supabase.co/auth/v1/health', {
      method: 'GET', signal: controller.signal, headers: { Accept: 'application/json' }
    });
    return res.status(response.ok ? 200 : 503).json({
      status: response.ok ? 'reachable' : 'unavailable',
      service: 'academy-auth',
      academy_data: 'not_commissioned'
    });
  } catch {
    return res.status(503).json({ status: 'unavailable', service: 'academy-auth', academy_data: 'not_commissioned' });
  } finally { clearTimeout(timer); }
}
