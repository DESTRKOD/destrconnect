import crypto from 'node:crypto';
import { migrate, migrateNewTables, getDb } from '../lib/db.js';
import { requireAdmin } from '../lib/adminAuth.js';
import { createClient } from '../lib/xui.js';
import { loadPanelsFromDb } from '../lib/panels.js';
import { makeToken } from '../lib/token.js';
import { clientPageUrlForToken, subscriptionUrlForToken } from '../lib/publicUrl.js';

function makeXuiEmail(displayName) {
  const base =
    String(displayName || 'sub')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9\u0400-\u04FF_\-]/g, '')
      .slice(0, 40) || 'sub';
  return base + '_' + crypto.randomBytes(3).toString('hex');
}

async function provision(email, { totalGB, expiryTime, enable, remark }) {
  const panels = await loadPanelsFromDb();
  const results = [];
  for (const [name, panel] of Object.entries(panels)) {
    if (!panel?.url) {
      results.push({ name, ok: false, error: 'no url' });
      continue;
    }
    try {
      await createClient(panel, email, {
        totalGB: Number(totalGB) || 0,
        expiryTime: Number(expiryTime) || 0,
        enable: enable !== false,
        remark: remark || email
      });
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, error: e.message });
    }
  }
  if (!Object.keys(panels).length) {
    results.push({ name: '_', ok: false, error: 'Нет серверов в админке. Добавьте на вкладке «Серверы».' });
  }
  return results;
}

export default async function adminCore(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key');
    return res.status(204).end();
  }

  try {
    await migrate();
    try { await migrateNewTables(); } catch (_) {}

    const gate = await requireAdmin(req);
    if (!gate || gate.ok === false) {
      return res.status(gate?.status || 401).json({
        ok: false,
        error: gate?.error || 'Unauthorized'
      });
    }

    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : req.body || {};
    const action = String(req.query?.action || body.action || '');

    const db = getDb();

    /* ---- list subscriptions ---- */
    if (action === 'list' || action === 'users') {
      const q = String(body.q || req.query?.q || '').trim();
      let sql = `SELECT * FROM subscriptions ORDER BY id DESC LIMIT 200`;
      let args = [];
      if (q) {
        sql = `SELECT * FROM subscriptions WHERE display_name LIKE ? OR xui_email LIKE ? OR CAST(id AS TEXT) = ? ORDER BY id DESC LIMIT 200`;
        args = ['%' + q + '%', '%' + q + '%', q];
      }
      const r = await db.execute({ sql, args });
      return res.status(200).json({ ok: true, items: r.rows || [] });
    }

    /* ---- create subscription ---- */
    if (action === 'create') {
      const displayName = String(body.name || body.displayName || 'sub').trim();
      const totalGb = Number(body.totalGb ?? body.total_gb ?? 0) || 0;
      const days = Number(body.days ?? body.expiry_days ?? 0) || 0;
      const expiryTime = days > 0 ? Date.now() + days * 86400000 : 0;
      const expiryAt =
        days > 0 ? new Date(expiryTime).toISOString() : null;

      const xuiEmail = makeXuiEmail(displayName);
      const subToken = makeToken(xuiEmail);

      const panelResults = await provision(xuiEmail, {
        totalGB: totalGb,
        expiryTime,
        enable: true,
        remark: displayName
      });

      // subscriptions.user_id has FK → always create a real user row first
      let uid = null;
      try {
        const u = await db.execute({
          sql: `INSERT INTO users (name) VALUES (?) RETURNING id`,
          args: [displayName]
        });
        uid = u.rows?.[0]?.id ?? u.rows?.[0]?.ID;
      } catch (e1) {
        try {
          await db.execute({
            sql: `INSERT INTO users (name) VALUES (?)`,
            args: [displayName]
          });
          const u2 = await db.execute({
            sql: `SELECT id FROM users WHERE name = ? ORDER BY id DESC LIMIT 1`,
            args: [displayName]
          });
          uid = u2.rows?.[0]?.id;
        } catch (e2) {
          throw new Error('Не удалось создать user: ' + (e2.message || e1.message));
        }
      }
      if (!uid) throw new Error('user id empty after insert');

      await db.execute({
        sql: `INSERT INTO subscriptions (user_id, display_name, xui_email, sub_token, total_gb, expiry_days, expiry_at, status, payment_status)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'unpaid')`,
        args: [uid, displayName, xuiEmail, subToken, totalGb, days, expiryAt]
      });

      const pageUrl = clientPageUrlForToken(subToken);
      const happUrl = subscriptionUrlForToken(subToken);

      return res.status(200).json({
        ok: true,
        pageUrl,
        happUrl,
        subToken,
        xuiEmail,
        panelResults
      });
    }

    /* ---- set payment + paid_until ---- */
    if (action === 'set_payment') {
      const id = Number(body.id || body.subscriptionId);
      const paid = body.paid === true || body.payment_status === 'paid';
      const paidUntil = body.paidUntil || body.paid_until || null;
      if (!id) return res.status(400).json({ ok: false, error: 'id required' });

      await db.execute({
        sql: `UPDATE subscriptions SET payment_status = ?, paid_until = COALESCE(?, paid_until),
              expiry_at = COALESCE(?, expiry_at), updated_at = datetime('now') WHERE id = ?`,
        args: [
          paid ? 'paid' : 'unpaid',
          paidUntil,
          paidUntil,
          id
        ]
      });
      return res.status(200).json({ ok: true });
    }

    /* ---- block / unblock ---- */
    if (action === 'block' || action === 'unblock') {
      const id = Number(body.id || body.subscriptionId);
      if (!id) return res.status(400).json({ ok: false, error: 'id required' });
      const st = action === 'block' ? 'blocked' : 'active';
      await db.execute({
        sql: `UPDATE subscriptions SET status = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [st, id]
      });
      return res.status(200).json({ ok: true, status: st });
    }

    /* ---- panels CRUD ---- */
    if (action === 'panels_list') {
      const r = await db.execute(`SELECT id, key_code, label, panel_url, inbound_id, server_host, enabled, sort_order, api_token FROM panels ORDER BY sort_order, id`);
      const rows = (r.rows || []).map((x) => ({
        id: x.id,
        key_code: x.key_code,
        label: x.label,
        panel_url: x.panel_url,
        inbound_id: x.inbound_id,
        server_host: x.server_host,
        enabled: x.enabled,
        sort_order: x.sort_order,
        has_token: Boolean(x.api_token)
      }));
      return res.status(200).json({ ok: true, db: rows, env: [] });
    }

    if (action === 'panel_add') {
      const key_code = String(body.key_code || body.key || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '');
      const label = String(body.label || key_code).trim();
      const panel_url = String(body.panel_url || body.url || '').trim();
      const api_token = String(body.api_token || body.token || '').trim();
      const server_host = String(body.server_host || body.server || '').trim();
      const inbound_id = Number(body.inbound_id || 1) || 1;
      if (!key_code || !panel_url || !server_host) {
        return res.status(400).json({ ok: false, error: 'key, url, server required' });
      }
      await db.execute({
        sql: `INSERT INTO panels (key_code, label, panel_url, api_token, inbound_id, server_host, enabled)
              VALUES (?, ?, ?, ?, ?, ?, 1)`,
        args: [key_code, label, panel_url, api_token || null, inbound_id, server_host]
      });
      return res.status(200).json({ ok: true });
    }

    if (action === 'panel_delete') {
      const id = Number(body.id);
      const key = String(body.key_code || '').trim();
      if (id) {
        await db.execute({ sql: `DELETE FROM panels WHERE id = ?`, args: [id] });
      } else if (key) {
        await db.execute({ sql: `DELETE FROM panels WHERE key_code = ?`, args: [key] });
      } else {
        return res.status(400).json({ ok: false, error: 'id or key required' });
      }
      // only removes from our DB → disappears from /api/sub listing of db panels; env panels remain
      return res.status(200).json({ ok: true });
    }

    if (action === 'panel_toggle') {
      const id = Number(body.id);
      await db.execute({
        sql: `UPDATE panels SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE id = ?`,
        args: [id]
      });
      return res.status(200).json({ ok: true });
    }

    
    if (action === 'vapid_public') {
      return res.status(200).json({
        ok: true,
        publicKey: process.env.VAPID_PUBLIC_KEY || ''
      });
    }

    if (action === 'push_subscribe') {
      const { savePushSubscription } = await import('../lib/push.js');
      await savePushSubscription(body.subscription || body);
      return res.status(200).json({ ok: true });
    }

    if (action === 'push_test') {
      const { sendPushToAll } = await import('../lib/push.js');
      const results = await sendPushToAll({
        title: 'Destr Connect',
        body: 'Тестовое уведомление админа',
        url: '/admin'
      });
      return res.status(200).json({ ok: true, results });
    }

    if (action === 'panels_health') {
      const { checkAllPanelsHealth } = await import('../lib/panels.js');
      const results = await checkAllPanelsHealth();
      return res.status(200).json({ ok: true, results });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
  } catch (e) {
    console.error('admin-core', e);
    return res.status(500).json({ ok: false, error: e.message || 'Error' });
  }
}
