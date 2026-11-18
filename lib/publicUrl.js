/** Destr Connect NEW — public URLs */
export function publicSubBase() {
  const raw =
    process.env.PUBLIC_SUB_URL ||
    process.env.SUB_PUBLIC_URL ||
    'https://dc.shopdxs.ru';
  return String(raw).replace(/\/$/, '');
}

/** Link for client (browser page) — secret access by token only */
export function clientPageUrlForToken(token) {
  const t = encodeURIComponent(String(token || '').trim());
  return publicSubBase() + '/sub?token=' + t;
}

/** Link for Happ subscription fetch */
export function subscriptionUrlForToken(token) {
  const t = encodeURIComponent(String(token || '').trim());
  return publicSubBase() + '/api/sub?token=' + t;
}

/** Deep link that opens Happ and adds the subscription */
export function happAddUrlForToken(token) {
  const sub = subscriptionUrlForToken(token);
  return 'happ://add/' + sub + '#Destr%20Connect';
}
