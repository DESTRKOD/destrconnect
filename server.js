import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: e.message || 'Error' });
      }
    }
  };
}

const { default: sub } = await import('./api/sub.js');
const { default: pub } = await import('./api/public.js');
const { default: adm } = await import('./api/admin.js');
const { default: cron } = await import('./api/cron.js');
const { default: authAdmin } = await import('./api/auth-admin.js');

app.all('/api/sub', wrap(sub));
app.all('/api/public', wrap(pub));
app.all('/api/admin', wrap(adm));
app.all('/api/cron', wrap(cron));
app.all('/api/auth-admin', wrap(authAdmin));

function sendHtml(res, file) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(__dirname, file));
}

app.get('/login', (req, res) => sendHtml(res, 'login.html'));
app.get('/setup', (req, res) => sendHtml(res, 'setup.html'));
app.get('/admin', (req, res) => sendHtml(res, 'admin.html'));
app.get('/sub', (req, res) => sendHtml(res, 'sub.html'));
app.get('/', (req, res) => {
  const host = String(req.headers.host || '');
  if (host.startsWith('admin.')) return res.redirect('/login');
  return res.redirect('/admin');
});

app.use(express.static(__dirname, { index: false }));

app.listen(PORT, '127.0.0.1', () => {
  console.log('Destr Connect on 127.0.0.1:' + PORT);
});
