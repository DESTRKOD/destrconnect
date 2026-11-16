import adminCore from '../api-handlers/admin-core.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  return adminCore(req, res);
}
