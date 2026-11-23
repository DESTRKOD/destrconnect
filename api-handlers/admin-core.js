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

function isAlreadyOnPanel(msg) {
  const m = String(msg || '').toLowerCase();
  return (
    m.includes('already') ||
    m.includes('duplicate') ||
    m.includes('exist') ||
    m.includes('in use')
  );
}

async function provision(email, { totalGB, expiryTime, enable, remark, soft = false }) {
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
      results.push({ name, ok: true, created: true });
    } catch (e) {
      if (soft && isAlreadyOnPanel(e.message)) {
        results.push({ name, ok: true, skipped: true });
      } else {
        results.push({ name, ok: false, error: e.message });
      }
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
      const sort = String(body.sort || req.query?.sort || 'default').trim();
      const orderBy = {
        default: 'id DESC',
        expiry_asc: 'COALESCE(paid_until, expiry_at) ASC NULLS LAST',
        expiry_desc: 'COALESCE(paid_until, expiry_at) DESC NULLS LAST',
        amount_asc: 'COALESCE(paid_amount, 0) ASC',
        amount_desc: 'COALESCE(paid_amount, 0) DESC'
      };
      // libsql/sqlite: NULLS LAST not always supported — use CASE
      const orderMap = {
        default: 'id DESC',
        expiry_asc: 'CASE WHEN COALESCE(paid_until, expiry_at) IS NULL THEN 1 ELSE 0 END, COALESCE(paid_until, expiry_at) ASC',
        expiry_desc: 'CASE WHEN COALESCE(paid_until, expiry_at) IS NULL THEN 1 ELSE 0 END, COALESCE(paid_until, expiry_at) DESC',
        amount_asc: 'COALESCE(paid_amount, 0) ASC',
        amount_desc: 'COALESCE(paid_amount, 0) DESC'
      };
      const order = orderMap[sort] || orderMap.default;
      let sql = `SELECT * FROM subscriptions ORDER BY ${order} LIMIT 300`;
      let args = [];
      if (q) {
        sql = `SELECT * FROM subscriptions WHERE display_name LIKE ? OR xui_email LIKE ? OR CAST(id AS TEXT) = ? ORDER BY ${order} LIMIT 300`;
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
      const paidAmount = Number(body.paidAmount ?? body.paid_amount ?? 0) || 0;
      let paidUntil = body.paidUntil || body.paid_until || null;
      if (paidUntil && !String(paidUntil).includes('T')) {
        // YYYY-MM-DD → end of day UTC-ish ISO
        paidUntil = String(paidUntil).trim() + 'T23:59:59.000Z';
      }
      const expiryTime = days > 0 ? Date.now() + days * 86400000 : 0;
      let expiryAt =
        days > 0 ? new Date(expiryTime).toISOString() : null;
      if (paidUntil) expiryAt = paidUntil;

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

      const payStatus = paidAmount > 0 || paidUntil ? 'paid' : 'unpaid';
      await db.execute({
        sql: `INSERT INTO subscriptions (user_id, display_name, xui_email, sub_token, total_gb, expiry_days, expiry_at, status, payment_status, paid_until, paid_amount)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        args: [uid, displayName, xuiEmail, subToken, totalGb, days, expiryAt, payStatus, paidUntil || expiryAt, paidAmount]
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

    
    if (action === 'panel_update') {
      const id = Number(body.id);
      if (!id) return res.status(400).json({ ok: false, error: 'id required' });
      const fields = [];
      const args = [];
      const map = {
        key_code: 'key_code',
        label: 'label',
        panel_url: 'panel_url',
        api_token: 'api_token',
        server_host: 'server_host',
        inbound_id: 'inbound_id',
        enabled: 'enabled',
        sort_order: 'sort_order'
      };
      for (const [k, col] of Object.entries(map)) {
        if (body[k] === undefined) continue;
        fields.push(col + ' = ?');
        if (k === 'inbound_id' || k === 'enabled' || k === 'sort_order') {
          args.push(Number(body[k]));
        } else {
          args.push(String(body[k]).trim());
        }
      }
      if (!fields.length) return res.status(400).json({ ok: false, error: 'nothing to update' });
      args.push(id);
      await db.execute({
        sql: `UPDATE panels SET ${fields.join(', ')} WHERE id = ?`,
        args
      });
      return res.status(200).json({ ok: true });
    }

    if (action === 'sync_subscriptions') {
      const subs = await db.execute(`SELECT id, xui_email, display_name, total_gb, expiry_at, paid_until FROM subscriptions WHERE status IS NULL OR status != 'blocked'`);
      const rows = subs.rows || [];
      const summary = [];
      for (const s of rows) {
        const email = s.xui_email;
        if (!email) {
          summary.push({ id: s.id, ok: false, error: 'no xui_email' });
          continue;
        }
        let expMs = 0;
        const raw = s.paid_until || s.expiry_at;
        if (raw) {
          const tms = new Date(raw).getTime();
          if (Number.isFinite(tms)) expMs = tms;
        }
        const results = await provision(email, {
          totalGB: Number(s.total_gb) || 0,
          expiryTime: expMs,
          enable: true,
          remark: s.display_name || email,
          soft: true
        });
        summary.push({
          id: s.id,
          email,
          ok: results.every((r) => r.ok),
          results
        });
      }
      return res.status(200).json({
        ok: true,
        total: rows.length,
        summary
      });
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
