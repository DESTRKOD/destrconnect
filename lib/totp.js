import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateBase32Secret(bytes = 20) {
  const buf = crypto.randomBytes(bytes);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32ToBuffer(secret) {
  const cleaned = String(secret || '')
    .toUpperCase()
    .replace(/=+$/, '')
    .replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const c of cleaned) {
    const idx = BASE32.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1e6).padStart(6, '0');
}

/** window = steps of 30s to allow clock skew */
export function verifyTotp(secret, token, window = 1) {
  const digits = String(token || '').replace(/\D/g, '');
  if (digits.length !== 6) return false;
  const key = base32ToBuffer(secret);
  if (!key.length) return false;
  const step = Math.floor(Date.now() / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    if (hotp(key, step + w) === digits) return true;
  }
  return false;
}

export function otpauthUrl(secret, { account = 'Admin', issuer = 'Destr Connect' } = {}) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30'
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

const secretFile = () =>
  process.env.ADMIN_TOTP_FILE ||
  path.join(process.cwd(), 'data', 'admin-totp.json');

export function loadTotpSecret() {
  if (process.env.ADMIN_TOTP_SECRET) {
    return String(process.env.ADMIN_TOTP_SECRET).replace(/\s+/g, '');
  }
  try {
    const raw = fs.readFileSync(secretFile(), 'utf8');
    const j = JSON.parse(raw);
    return j.secret || null;
  } catch {
    return null;
  }
}

export function saveTotpSecret(secret) {
  const file = secretFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ secret, createdAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 }
  );
}

export function isTotpConfigured() {
  return Boolean(loadTotpSecret());
}
