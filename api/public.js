import publicSub from '../api-handlers/public-sub.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = String(req.query?.action || 'sub');
  if (action === 'sub') return publicSub(req, res);
  return res.status(404).json({ ok: false, error: 'Unknown action' });
}
