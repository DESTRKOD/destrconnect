
import { runExpiryReminders } from '../lib/push.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET || process.env.ADMIN_API_KEY || '';
  const got =
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '') ||
    req.query?.secret ||
    '';
  const isVercelCron = Boolean(req.headers['x-vercel-cron']);
  if (!isVercelCron && (!secret || got !== secret)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  try {
    const result = await runExpiryReminders();
    return res.status(200).json(result);
  } catch (e) {
    console.error('cron', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
