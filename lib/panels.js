import { getDb, migrate, migrateNewTables } from './db.js';

/** Panel row from DB → shape used by xui.js */
export function rowToPanel(row) {
  if (!row) return null;
  return {
    key: String(row.key_code || row.key || '').toLowerCase(),
    url: String(row.panel_url || row.url || '').replace(/\/$/, ''),
    token: row.api_token || row.token || '',
    user: row.panel_user || row.user || '',
    pass: row.panel_pass || row.pass || '',
    inboundId: Number(row.inbound_id || row.inboundId || 1) || 1,
    server: row.server_host || row.server || '',
    name: row.label || row.key_code,
    label: row.label || row.key_code,
    enabled: row.enabled === undefined ? true : Boolean(Number(row.enabled)),
    id: row.id
  };
}

/** Only servers from admin DB (enabled). No ENV panels. */
export async function loadPanelsFromDb({ includeDisabled = false } = {}) {
  await migrate();
  try {
    await migrateNewTables();
  } catch (_) {}
  const db = getDb();
  const sql = includeDisabled
    ? `SELECT * FROM panels ORDER BY sort_order, id`
    : `SELECT * FROM panels WHERE enabled = 1 ORDER BY sort_order, id`;
  const r = await db.execute(sql);
  const out = {};
  for (const row of r.rows || []) {
    const p = rowToPanel(row);
    if (p?.key && p.url) out[p.key] = p;
  }
  return out;
}

/**
 * Real availability check: Bearer (or login) + GET inbound.
 * Returns { key, label, ok, ms, error }
 */
export async function checkPanelHealth(panel, timeoutMs = 6000) {
  const started = Date.now();
  const label = panel.label || panel.key;
  const key = panel.key;
  if (!panel?.url) {
    return { key, label, ok: false, ms: 0, error: 'no url', status: 'down' };
  }
  const base = String(panel.url).replace(/\/$/, '');
  const path = '/panel/api/inbounds/get/' + (panel.inboundId || 1);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    };
    if (panel.token) {
      headers.Authorization = 'Bearer ' + String(panel.token).trim();
    }
    const r = await fetch(base + path, { method: 'GET', headers, signal: ctrl.signal });
    const ms = Date.now() - started;
    if (r.ok) {
      return { key, label, ok: true, ms, status: 'ok' };
    }
    // 401/403 = panel reachable but auth wrong
    if (r.status === 401 || r.status === 403) {
      return {
        key,
        label,
        ok: false,
        ms,
        status: 'down',
        error: 'HTTP ' + r.status + ' (auth)'
      };
    }
    return {
      key,
      label,
      ok: false,
      ms,
      status: 'down',
      error: 'HTTP ' + r.status
    };
  } catch (e) {
    return {
      key,
      label,
      ok: false,
      ms: Date.now() - started,
      status: 'down',
      error: e.name === 'AbortError' ? 'timeout' : e.message
    };
  } finally {
    clearTimeout(t);
  }
}

export async function checkAllPanelsHealth() {
  const panels = await loadPanelsFromDb();
  const list = Object.values(panels);
  const results = await Promise.all(list.map((p) => checkPanelHealth(p)));
  return results;
}
