import { migrate, migrateNewTables, getDb } from '../lib/db.js';
import { readToken } from '../lib/token.js';
import { getTrafficForEmail } from '../lib/traffic.js';
import { loadPanelsFromDb, checkPanelHealth } from '../lib/panels.js';
import { subscriptionUrlForToken } from '../lib/publicUrl.js';

export default async function publicSub(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  try {
    await migrate();
    try { await migrateNewTables(); } catch (_) {}

    const token = String(req.query?.token || '').trim();
    if (!token) {
      return res.status(400).json({ ok: false, error: 'Нет токена' });
    }

    let email;
    try {
      email = readToken(token);
    } catch (e) {
      return res.status(403).json({ ok: false, error: 'Недействительная ссылка' });
    }

    const db = getDb();
    const r = await db.execute({
      sql: `SELECT * FROM subscriptions WHERE sub_token = ? LIMIT 1`,
      args: [token]
    });
    let sub = r.rows[0];
    if (!sub) {
      const r2 = await db.execute({
        sql: `SELECT * FROM subscriptions WHERE xui_email = ? LIMIT 1`,
        args: [email]
      });
      sub = r2.rows[0];
    }
    if (!sub) {
      return res.status(404).json({ ok: false, error: 'Подписка не найдена' });
    }

    const status = String(sub.status || 'active');
    const totalGb = Number(sub.total_gb) || 0;
    let usedGb = 0;
    try {
      const tr = await getTrafficForEmail(sub.xui_email);
      usedGb = (Number(tr.up || 0) + Number(tr.down || 0)) / (1024 ** 3);
    } catch (_) {}

    const paidUntil = sub.paid_until || sub.expiry_at || null;
    const paymentStatus = sub.payment_status || 'unknown';

    const panelsMap = await loadPanelsFromDb();
    const health = await Promise.all(
      Object.values(panelsMap).map((p) => checkPanelHealth(p, 5000))
    );
    const servers = health.map((h) => ({
      key: h.key,
      label: h.label,
      status: h.ok ? 'ok' : 'down',
      ms: h.ms,
      error: h.error || null
    }));

    return res.status(200).json({
      ok: true,
      displayName: sub.display_name,
      status,
      paymentStatus,
      paidUntil,
      expiryAt: sub.expiry_at,
      totalGb,
      usedGb: Math.round(usedGb * 10) / 10,
      unlimited: totalGb <= 0,
      servers,
      happUrl: subscriptionUrlForToken(token)
    });
  } catch (e) {
    console.error('public-sub', e);
    return res.status(500).json({ ok: false, error: e.message || 'Error' });
  }
}
