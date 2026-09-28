// RFC 6238: Base32 kulcs, HMAC-SHA1, 6 számjegy, 30 másodperces időablak.
export function decodeBase32(secret) {
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

export async function generateTotp(secret, time = Date.now(), digits = 6) {
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
