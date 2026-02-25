# Authentik IdP Setup + Demo App

This project includes:
- A local Authentik Identity Provider (IdP) via Docker Compose
- A demo web app on `http://localhost:3000` that authenticates with Authentik using OIDC Authorization Code + PKCE
- Passkey registration shortcut from the demo app
- Blueprint config at `blueprints/demo.yml` (manual apply)

## 1. Start Authentik

```bash
npm run authentik:up
```

Authentik URLs:
- User/Admin UI: `http://localhost:9000`
- Admin interface: `http://localhost:9000/if/admin/`

Required env vars are loaded from `.env`:
- `PG_PASS`
- `AUTHENTIK_SECRET_KEY`
- Optional: `PG_DB` (default `authentik`)
- Optional: `PG_USER` (default `authentik`)
- Optional: `AUTHENTIK_BOOTSTRAP_TOKEN` (for first admin setup link)

If this is the first startup, create your initial admin via:
- `http://localhost:9000/if/flow/initial-setup/`
- Or with token: `http://localhost:9000/if/flow/initial-setup/?token=<AUTHENTIK_BOOTSTRAP_TOKEN>`

## 2. Apply the demo blueprint

The blueprint creates only demo-specific objects (provider/app/login flow/test user) and does not overwrite global admin login flows.

```bash
docker compose exec -T worker ak apply_blueprint /blueprints/example/demo.yml
```

Created objects:
- OAuth2 Provider: `BA Demo OIDC Provider` (`client_id=demo-app`, redirect URI `http://localhost:3000`)
- Application: `BA Demo App` (slug `demo`)
- Authentication flow: `ba-demo-web-login` with identification + user login stages
- Passwordless passkey flow: `ba-demo-passkey-login`
- Test user: `demo` / `demo`

## 3. Start Demo App

```bash
npm run start
```

Demo app URL:
- `http://localhost:3000`

## 4. Test Login + Passkey

1. Open `http://localhost:3000`
2. Click **Login** and sign in once
3. Click **Register Passkey**
4. Complete browser/device prompt
5. Logout and login again with passkey

The demo app opens passkey registration at:
- `http://localhost:9000/if/flow/default-authenticator-webauthn-setup/`

## Stop Authentik

```bash
npm run authentik:down
```
