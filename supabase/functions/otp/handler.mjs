import { generateTotp } from './totp.mjs';

export function createOtpHandler({ env, fetcher = fetch, now = Date.now }) {
  return async function handle(request) {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Cache-Control': 'no-store, private',
      'Pragma': 'no-cache',
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff'
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const authorization = request.headers.get('Authorization') || '';
    if (!/^Bearer\s+\S+$/i.test(authorization)) return json({ error: 'unauthorized' }, 401);
    const url = env('SUPABASE_URL');
    const key = env('SUPABASE_ANON_KEY');
    if (!url || !key) return json({ error: 'not_configured' }, 503);

    try {
      const authHeaders = { apikey: key, Authorization: authorization };
      // A token valódiságát és a munkamenetet a Supabase Auth ellenőrzi.
      // Nem elegendő a JWT tartalmának dekódolása vagy a kliens UI-ja.
      const userResponse = await fetcher(`${url}/auth/v1/user`, {
        headers: authHeaders, signal: AbortSignal.timeout(8000)
      });
      if (!userResponse.ok) return json({ error: userResponse.status >= 500 ? 'upstream_error' : 'unauthorized' }, userResponse.status >= 500 ? 502 : 401);
      const user = await userResponse.json();
      if (!user.id) return json({ error: 'unauthorized' }, 401);

      // Ugyanaz a névsor és JWT-alapú jogosultság, mint a beosztásnál.
      // Nem használunk service_role kulcsot, így az RLS is érvényesül.
      const memberResponse = await fetcher(`${url}/rest/v1/rpc/whoami`, {
        method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: '{}', signal: AbortSignal.timeout(8000)
      });
      if (!memberResponse.ok) return json({ error: 'membership_check_failed' }, 502);
      const members = await memberResponse.json();
      if (!Array.isArray(members) || !members[0]?.id) return json({ error: 'forbidden' }, 403);
      const secret = env('OTP_SECRET');
      if (!secret) return json({ error: 'not_configured' }, 503);
      try {
        return json(await generateTotp(secret, now()));
      } catch {
        return json({ error: 'not_configured' }, 503);
      }
    } catch {
      // Sem tokent, sem secretet, sem OTP-kódot nem naplózunk.
      return json({ error: 'upstream_error' }, 502);
    }
  };
}
