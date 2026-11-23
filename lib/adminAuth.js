import { checkAdminKey, isAdminTgId, verifyInitData, getSessionUser } from './auth.js';
import { getSessionFromRequest } from './adminSession.js';

/**
 * Admin gate:
 * 1) Valid TOTP session cookie (preferred for browser / PWA)
 * 2) ADMIN_API_KEY via header / body / query (optional automation)
 * 3) Optional Telegram admin if ADMIN_REQUIRE_TG=1
 */
export async function requireAdmin(req) {
  const body =
    typeof req.body === 'string'
      ? (() => {
          try {
            return JSON.parse(req.body || '{}');
          } catch {
            return {};
          }
        })()
      : req.body || {};

  const session = getSessionFromRequest(req);
  if (session) {
    return { ok: true, session: true };
  }

  const authHeader = String(req.headers.authorization || '');
  const bearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const key = String(
    req.headers['x-admin-key'] ||
      req.query?.admin ||
      req.query?.key ||
      body.adminKey ||
      bearer ||
      ''
  ).trim();

  if (process.env.ADMIN_API_KEY && key && checkAdminKey(key)) {
    const requireTg =
      process.env.ADMIN_REQUIRE_TG === '1' ||
      process.env.ADMIN_REQUIRE_TG === 'true';
    if (!requireTg) {
      return { ok: true, keyOnly: true };
    }
    const initData =
      body.initData || req.headers['x-telegram-init-data'] || '';
    if (initData) {
      const tgUser = verifyInitData(initData);
      if (tgUser?.id && isAdminTgId(tgUser.id)) {
        return { ok: true, tgId: Number(tgUser.id) };
      }
      return { ok: false, status: 403, error: 'Этот Telegram-аккаунт не админ' };
    }
    const token =
      body.token ||
      (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (token) {
      const user = await getSessionUser(token);
      if (user?.tg_id && isAdminTgId(user.tg_id)) {
        return { ok: true, user };
      }
    }
    return {
      ok: false,
      status: 403,
      error: 'Нужен Telegram-админ (ADMIN_REQUIRE_TG=1)'
    };
  }

  return {
    ok: false,
    status: 401,
    error: 'Нужна авторизация. Войдите на /login'
  };
}
