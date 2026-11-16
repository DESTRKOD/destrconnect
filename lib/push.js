import webpush from 'web-push';
import { getDb, migrate, migrateNewTables } from './db.js';

export function configureVapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY || '';
  const privateKey = process.env.VAPID_PRIVATE_KEY || '';
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@connect.shopdxs.ru';
  if (!publicKey || !privateKey) {
    throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set');
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return { publicKey };
}

export async function savePushSubscription(sub) {
  await migrate();
  try {
    await migrateNewTables();
  } catch (_) {}
  const db = getDb();
  const endpoint = String(sub.endpoint || '');
  const p256dh = sub.keys?.p256dh || '';
  const auth = sub.keys?.auth || '';
  if (!endpoint) throw new Error('endpoint required');
  await db.execute({
    sql: `INSERT INTO admin_push (endpoint, p256dh, auth_key) VALUES (?, ?, ?)
          ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth_key = excluded.auth_key`,
    args: [endpoint, p256dh, auth]
  });
}

export async function listPushSubscriptions() {
  const db = getDb();
  const r = await db.execute(`SELECT * FROM admin_push`);
  return (r.rows || []).map((row) => ({
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth_key }
  }));
}

export async function sendPushToAll(payload) {
  configureVapid();
  const subs = await listPushSubscriptions();
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const results = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, body);
      results.push({ endpoint: sub.endpoint, ok: true });
    } catch (e) {
      results.push({ endpoint: sub.endpoint, ok: false, error: e.message });
      if (e.statusCode === 410 || e.statusCode === 404) {
        try {
          await getDb().execute({
            sql: `DELETE FROM admin_push WHERE endpoint = ?`,
            args: [sub.endpoint]
          });
        } catch (_) {}
      }
    }
  }
  return results;
}

/** Remind admin about subs expiring within ~3 days */
export async function runExpiryReminders() {
  await migrate();
  try {
    await migrateNewTables();
  } catch (_) {}
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT id, display_name, paid_until, expiry_at, payment_status, status
          FROM subscriptions
          WHERE status IS NULL OR status != 'blocked'`
  });
  const now = Date.now();
  const in3 = now + 3 * 86400000;
  const due = [];
  for (const row of r.rows || []) {
    const raw = row.paid_until || row.expiry_at;
    if (!raw) continue;
    const t = new Date(raw).getTime();
    if (!Number.isFinite(t)) continue;
    if (t >= now && t <= in3) {
      due.push(row);
    }
  }
  if (!due.length) {
    return { ok: true, sent: 0, due: 0 };
  }
  const names = due
    .map((x) => '#' + x.id + ' ' + (x.display_name || ''))
    .join(', ');
  const results = await sendPushToAll({
    title: 'Destr Connect',
    body:
      'Через 3 дня или раньше заканчивается оплата: ' +
      names +
      '. Напомните клиенту.',
    url: '/admin'
  });
  return { ok: true, sent: results.filter((x) => x.ok).length, due: due.length, results };
}
