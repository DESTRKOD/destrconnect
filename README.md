# Destr Connect NEW

## Links
- Client (secret): `https://connect.shopdxs.ru/sub?token=...`
- Happ API: `https://connect.shopdxs.ru/api/sub?token=...`
- Admin PWA: `https://connect.shopdxs.ru/admin?key=ADMIN_API_KEY`

## Env
- `PUBLIC_SUB_URL=https://connect.shopdxs.ru`
- `ADMIN_API_KEY=...`
- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`
- `DE_*` / `RU_*` panel vars (as before)
- `SUB_TOKEN_SECRET` (token signing, same as before)

## Flow
1. Admin creates subscription → gets **page URL** for client
2. Client opens only that link → status, traffic, QR, Happ
3. Nobody else without token
