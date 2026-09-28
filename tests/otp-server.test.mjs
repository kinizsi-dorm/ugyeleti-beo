import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeBase32, generateTotp } from '../supabase/functions/otp/totp.mjs';
import { createOtpHandler } from '../supabase/functions/otp/handler.mjs';

// Nyilvános RFC 6238 tesztkulcs, nem éles secret.
const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'],
  [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
for (const [seconds, expected] of vectors) {
  test(`RFC 6238 SHA-1 at ${seconds}`, async () => {
    assert.equal((await generateTotp(secret, seconds * 1000, 8)).code, expected);
    assert.equal((await generateTotp(secret, seconds * 1000)).code, expected.slice(-6));
  });
}
test('Base32 normalization, padding, invalid inputs', () => {
  assert.equal(new TextDecoder().decode(decodeBase32(secret.toLowerCase() + ' ')), '12345678901234567890');
  assert.deepEqual(decodeBase32('MFRGGZDFMZTWQ2LKMFRQ===='), decodeBase32('MFRGGZDFMZTWQ2LKMFRQ'));
  for (const invalid of ['', 'abc', '0123456789', 'otpauth://totp/example', secret + 'A', secret + '=', secret + 'AB']) {
    assert.throws(() => decodeBase32(invalid));
  }
});
test('30-second boundary and leading zero are preserved', async () => {
  const before = await generateTotp(secret, 29999);
  const after = await generateTotp(secret, 30000);
  assert.equal(before.expiresAt, 30000);
  assert.equal(after.expiresAt, 60000);
  assert.notEqual(before.code, after.code);
  assert.equal((await generateTotp(secret, 1111111109000)).code, '081804');
});

function setup({ authStatus = 200, members = [{ id: 'member' }], memberStatus = 200, otpSecret = secret, fail = false } = {}) {
  const calls = [];
  const env = name => ({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'public-key', OTP_SECRET: otpSecret })[name];
  const handler = createOtpHandler({ env, now: () => 59000, fetcher: async (url, options) => {
    calls.push({ url, options });
    if (fail) throw new Error('Private upstream details');
    return url.endsWith('/auth/v1/user')
      ? Response.json({ id: 'user' }, { status: authStatus })
      : Response.json(members, { status: memberStatus });
  } });
  const request = (token = 'user-jwt', method = 'POST') => handler(new Request('https://test.supabase.co/functions/v1/otp', {
    method, headers: token ? { Authorization: `Bearer ${token}` } : {}
  }));
  return { calls, request };
}
test('preflight and missing token never access the backend', async () => {
  const { request, calls } = setup();
  assert.equal((await request(null, 'OPTIONS')).status, 204);
  assert.equal((await request(null)).status, 401);
  assert.equal((await request(null, 'GET')).status, 405);
  assert.equal(calls.length, 0);
});
test('invalid or expired token is rejected before membership lookup', async () => {
  const { request, calls } = setup({ authStatus: 401 });
  assert.equal((await request()).status, 401);
  assert.equal(calls.length, 1);
});
test('signed-in nonmember cannot read the code', async () => {
  assert.equal((await setup({ members: [] }).request()).status, 403);
});
test('member receives only current code and timing, using their JWT for both checks', async () => {
  const { request, calls } = setup();
  const response = await request();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.deepEqual(await response.json(), { code: '287082', period: 30, serverTime: 59000, expiresAt: 60000 });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.options.headers.Authorization, 'Bearer user-jwt');
    assert.equal(call.options.headers.apikey, 'public-key');
  }
});
test('missing or malformed secret fails closed', async () => {
  for (const otpSecret of ['', 'not-a-base32-secret']) {
    const response = await setup({ otpSecret }).request();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'not_configured' });
  }
});
test('upstream and membership failures do not expose details or a code', async () => {
  for (const options of [{ fail: true }, { memberStatus: 500 }, { authStatus: 503 }]) {
    const response = await setup(options).request();
    assert.equal(response.status, 502);
    assert.equal(Object.keys(await response.json()).join(), 'error');
  }
});
