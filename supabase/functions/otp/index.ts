// Supabase Dashboard → Edge Functions → Deploy a new function → Via Editor.
// Név: otp. Az index.ts teljes tartalmát másold be, majd Deploy function.
// Secrets: OTP_SECRET = a Base32 TOTP-kulcs.
// Details → Verify JWT with legacy secret: OFF.
// A tokent és a névsor-tagságot az alábbi handler minden kérésnél ellenőrzi.
// Önálló fájl: nincs import, külön modul, csomagtelepítés vagy build.

// RFC 6238: Base32 kulcs, HMAC-SHA1, 6 számjegy, 30 másodperces időablak.
export function decodeBase32(secret: string) {
  const value = secret.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z2-7]+={0,6}$/.test(value)) throw new Error('Invalid Base32 secret');
  const plain = value.replace(/=+$/, '');
  const remainder = plain.length % 8;
  if (![0, 2, 4, 5, 7].includes(remainder) ||
      (value.includes('=') && value.length % 8 !== 0)) throw new Error('Invalid Base32 length');
  let bits = 0, buffer = 0;
  const bytes = [];
  for (const char of plain) {
    buffer = (buffer << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >>> bits) & 255); }
    buffer &= (1 << bits) - 1;
  }
  if (buffer !== 0 || bytes.length < 10) throw new Error('Invalid or too short Base32 secret');
  return new Uint8Array(bytes);
}

export async function generateTotp(secret: string, time = Date.now(), digits = 6) {
  if (!Number.isFinite(time) || time < 0 || ![6, 8].includes(digits)) throw new Error('Invalid TOTP parameters');
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(Math.floor(time / 30000)));
  const key = await crypto.subtle.importKey('raw', decodeBase32(secret),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const hash = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const offset = hash[hash.length - 1] & 15;
  const binary = new DataView(hash.buffer).getUint32(offset) & 0x7fffffff;
  return {
    code: String(binary % (10 ** digits)).padStart(digits, '0'),
    period: 30,
    serverTime: time,
    expiresAt: (Math.floor(time / 30000) + 1) * 30000
  };
}

type OtpDependencies = {
  env: (name: string) => string | undefined;
  fetcher?: typeof fetch;
  now?: () => number;
};

export function createOtpHandler({ env, fetcher = fetch, now = Date.now }: OtpDependencies) {
  return async function handle(request: Request) {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Cache-Control': 'no-store, private',
      'Pragma': 'no-cache',
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff'
    };
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
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

// A feltétel csak a helyi Node-tesztek importálását teszi lehetővé.
// A Supabase Deno futtatókörnyezetében a HTTP-kiszolgáló azonnal elindul.
if (typeof Deno !== 'undefined') {
  Deno.serve(createOtpHandler({ env: (name: string) => Deno.env.get(name) }));
}
