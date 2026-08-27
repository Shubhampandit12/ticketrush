# Deploying TicketRush to Render

Three services (inventory, order, portal) + one managed Redis. Each app service is built straight from its own Dockerfile. Every service binds to whatever port Render injects via the `PORT` env var — Render sets this automatically, you don't set it yourself.

## 0. Push the repo to GitHub

Render deploys from a Git repo it can pull from. This repo has no remote configured yet, so before anything else:

```bash
git add -A
git commit -m "Initial TicketRush build"
gh repo create ticketrush --private --source=. --remote=origin
git push -u origin main
```

(Or create the GitHub repo in the UI first, then `git remote add origin <url>` and `git push -u origin main`.)

## 1. Provision Redis

Render dashboard → **New → Redis**. Any free/starter plan is fine for a demo. Once it's up, open it and copy the **Internal Connection String** (something like `redis://red-xxxx:6379`) — internal, not external, since the other services will run in the same Render network.

## 2. Deploy inventory-service

**New → Web Service** → connect the GitHub repo → set **Root Directory** to `inventory-service` → Render detects the Dockerfile automatically (Environment: Docker).

Environment variables:

| Key | Value |
|---|---|
| `REDIS_URL` | the Redis internal connection string from step 1 |
| `TICKET_COUNT` | `500` (or whatever stock you want for the demo) |
| `STREAM_KEY` | `ticket_reservations` |
| `ADMIN_RESET_SECRET` | a strong random value — **do not reuse the local dev default** |

Don't set `INVENTORY_PORT` or `PORT` — Render injects `PORT` itself and the app binds to it automatically.

Deploy, then note the public URL Render gives this service, e.g. `https://ticketrush-inventory.onrender.com`.

## 3. Deploy order-service

**New → Web Service** → Root Directory `order-service` → Dockerfile detected.

Environment variables:

| Key | Value |
|---|---|
| `REDIS_URL` | same Redis internal connection string as step 2 |
| `STREAM_KEY` | `ticket_reservations` |
| `CONSUMER_GROUP` | `order-service-group` |
| `CONSUMER_NAME` | `order-service-1` |
| `DATABASE_URL` | `/app/data/orders.db` |

Both the HTTP API and the WebSocket are served on the same port (`/ws` path), so there's nothing extra to configure for that — this used to need a second exposed port, which Render's single-port-per-service model doesn't support; the code was changed to share one port specifically so this deploys cleanly.

Attach a persistent disk mounted at `/app/data` under **Disks** if you want order history to survive restarts — otherwise SQLite resets every time the container restarts, which is fine for a demo.

Note this service's public URL too, e.g. `https://ticketrush-orders.onrender.com`.

## 4. Deploy the portal

**New → Web Service** (not a Static Site, since it needs its own tiny Node server to serve the injected config) → Root Directory `portal` → Dockerfile detected.

The portal needs to know the other two services' public URLs. The simplest way: add a small inline script to `portal/index.html`, right before the `<script src="app.js">` line, pointing at your actual deployed URLs:

```html
<script>
  window.TICKETRUSH_INVENTORY_URL = 'https://ticketrush-inventory.onrender.com';
  window.TICKETRUSH_WS_URL = 'wss://ticketrush-orders.onrender.com/ws';
</script>
```

Commit that change (with your real Render URLs from steps 2–3) and push — Render redeploys on push automatically. `wss://` (not `ws://`) is required since Render serves everything over TLS.

## 5. Resetting between demos

The ticket counter doesn't reset itself. Before each live run:

```bash
curl -X POST https://ticketrush-inventory.onrender.com/admin/reset \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: <ADMIN_RESET_SECRET>" \
  -d '{"count": 500}'
```

Never redeploy just to reset the counter — the endpoint exists precisely so you don't have to.

## Free-tier note

Render's free web services spin down after inactivity and take ~30–60s to wake on the next request. For a live demo, either upgrade to a paid instance beforehand or hit `/health` on both services a minute ahead of time to warm them up.

## Local development (no Docker required)

This build environment didn't have Docker installed, so local development here ran the three Node processes directly against a Homebrew-installed Redis rather than `docker-compose up`:

```bash
brew install redis
redis-server --daemonize yes

cd inventory-service && npm install && REDIS_URL=redis://localhost:6379 TICKET_COUNT=500 node src/server.js &
cd order-service && npm install && REDIS_URL=redis://localhost:6379 node --experimental-sqlite src/server.js &
cd portal && node server.js &
```

If you have Docker available, `docker-compose up --build` from the repo root should work directly — the Dockerfiles and compose file were written for it and validated in GitHub Actions CI, but were not run through `docker-compose` in this environment since Docker wasn't installed here.
