import crypto from 'node:crypto';

const COOKIE = 'dc_admin_sess';
const TTL_MS = 24 * 60 * 60 * 1000;

function secret() {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error('APP_SECRET must be at least 32 characters');
  return s;
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

export function createAdminSession() {
  const payload = Buffer.from(
    JSON.stringify({ t: 'admin', exp: Date.now() + TTL_MS })
  ).toString('base64url');
  return payload + '.' + sign(payload);
}

export function readAdminSession(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.t !== 'admin' || !data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const header = req.headers?.cookie || '';
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  return readAdminSession(cookies[COOKIE] || '');
}

export function sessionCookieHeader(token) {
  const maxAge = Math.floor(TTL_MS / 1000);
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookieHeader() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export { COOKIE, TTL_MS };
