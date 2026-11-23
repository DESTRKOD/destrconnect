import {
  generateBase32Secret,
  verifyTotp,
  otpauthUrl,
  loadTotpSecret,
  saveTotpSecret,
  isTotpConfigured
} from '../lib/totp.js';
import {
  createAdminSession,
  getSessionFromRequest,
  sessionCookieHeader,
  clearSessionCookieHeader
} from '../lib/adminSession.js';
import { timingSafeEqualStr } from '../lib/auth.js';

/** IP → { fails, blockedUntil } */
const attempts = new Map();

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const row = attempts.get(ip);
  if (!row) return { ok: true };
  if (row.blockedUntil && row.blockedUntil > now) {
    const sec = Math.ceil((row.blockedUntil - now) / 1000);
    return { ok: false, error: `Слишком много попыток. Подождите ${sec} с` };
  }
  return { ok: true };
}

function recordFail(ip) {
  const now = Date.now();
  const row = attempts.get(ip) || { fails: 0, blockedUntil: 0 };
  row.fails += 1;
  if (row.fails >= 5) {
    row.blockedUntil = now + 5 * 60 * 1000;
    row.fails = 0;
  }
  attempts.set(ip, row);
}

function recordSuccess(ip) {
  attempts.delete(ip);
}

function readBody(req) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      return {};
    }
  }
  return req.body || {};
}

function setupTokenOk(token) {
  const expected = process.env.ADMIN_SETUP_TOKEN || '';
  if (!expected) return false;
  return timingSafeEqualStr(String(token || ''), expected);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = String(req.query?.action || readBody(req).action || '').trim();

  try {
    if (action === 'status' && req.method === 'GET') {
      const session = getSessionFromRequest(req);
      return res.status(200).json({
        ok: true,
        configured: isTotpConfigured(),
        loggedIn: Boolean(session),
        exp: session?.exp || null
      });
    }

    if (action === 'setup_info' && req.method === 'GET') {
      const token = req.query?.token || '';
      if (!setupTokenOk(token)) {
        return res.status(401).json({ ok: false, error: 'Неверный setup token' });
      }
      if (isTotpConfigured() && process.env.ADMIN_ALLOW_RESET !== '1') {
        return res.status(400).json({
          ok: false,
          error: '2FA уже настроена. Сброс: ADMIN_ALLOW_RESET=1 или удалите data/admin-totp.json'
        });
      }
      const secret = generateBase32Secret();
      // keep pending in memory keyed by token hash briefly
      globalThis.__pendingTotp = globalThis.__pendingTotp || new Map();
      globalThis.__pendingTotp.set(String(token), {
        secret,
        exp: Date.now() + 15 * 60 * 1000
      });
      return res.status(200).json({
        ok: true,
        secret,
        otpauth: otpauthUrl(secret, { account: 'admin.shopdxs.ru', issuer: 'Destr Connect' })
      });
    }

    if (action === 'setup_confirm' && req.method === 'POST') {
      const body = readBody(req);
      const token = body.setupToken || body.token || '';
      const code = String(body.code || '').replace(/\D/g, '');
      if (!setupTokenOk(token)) {
        return res.status(401).json({ ok: false, error: 'Неверный setup token' });
      }
      const pending = globalThis.__pendingTotp?.get(String(token));
      if (!pending || pending.exp < Date.now()) {
        return res.status(400).json({
          ok: false,
          error: 'Секрет устарел. Обновите страницу setup'
        });
      }
      if (!verifyTotp(pending.secret, code)) {
        return res.status(400).json({ ok: false, error: 'Неверный код' });
      }
      saveTotpSecret(pending.secret);
      globalThis.__pendingTotp.delete(String(token));
      const sess = createAdminSession();
      res.setHeader('Set-Cookie', sessionCookieHeader(sess));
      return res.status(200).json({ ok: true });
    }

    if (action === 'login' && req.method === 'POST') {
      const ip = clientIp(req);
      const lim = checkRateLimit(ip);
      if (!lim.ok) return res.status(429).json({ ok: false, error: lim.error });

      const secret = loadTotpSecret();
      if (!secret) {
        return res.status(400).json({
          ok: false,
          error: '2FA ещё не настроена. Откройте /setup'
        });
      }
      const code = String(readBody(req).code || '').replace(/\D/g, '');
      if (code.length !== 6) {
        return res.status(400).json({ ok: false, error: 'Введите 6 цифр' });
      }
      if (!verifyTotp(secret, code)) {
        recordFail(ip);
        return res.status(401).json({ ok: false, error: 'Неверный код' });
      }
      recordSuccess(ip);
      const sess = createAdminSession();
      res.setHeader('Set-Cookie', sessionCookieHeader(sess));
      return res.status(200).json({ ok: true });
    }

    if (action === 'logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', clearSessionCookieHeader());
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    console.error('auth-admin', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
