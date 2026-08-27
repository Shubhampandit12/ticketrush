# TicketRush

A ticket-reservation system built around one problem: when N people click "buy" on the last ticket at the same instant, exactly `min(N, remaining)` should succeed and the rest should get a clean "sold out" — no overselling, no lost updates.

## The race condition, and how it's solved

The naive approach — `GET` the counter, check if it's positive, then `DECR` — is two separate round-trips to Redis. Under concurrency, two requests can both `GET` the same value, both see it's positive, and both `DECR`, overselling by one. This happens silently and only under real load, which is exactly what makes it dangerous.

The fix is a Lua script run via `EVAL` (`inventory-service/src/reservation.lua`):

```lua
local remaining = redis.call('GET', KEYS[1])
if tonumber(remaining) > 0 then
  redis.call('DECR', KEYS[1])
  redis.call('XADD', KEYS[2], '*', 'reservationId', ARGV[1], 'timestamp', ARGV[2])
  return 1
else
  return 0
end
```

Redis executes Lua scripts as a single atomic operation — no other command can interleave between the check and the decrement, so the race condition doesn't exist at the storage layer. The `XADD` is folded into the same script rather than issued as a second call afterward: if it were a separate round-trip, a crash or dropped connection between the decrement and the `XADD` would silently burn a ticket with no order ever created for it. Doing both in one script means either both happen or neither does.

## Proof

Two tests exercise this under load:

- `inventory-service/test/reservation.lua.test.js` — 500 concurrent calls straight against Redis, no HTTP involved. Also asserts the stream ends up with exactly one entry per successful reservation, proving the decrement and the `XADD` stayed in lockstep.
- `inventory-service/test/concurrency.test.js` — 500 concurrent `POST /reserve` calls through the real HTTP server, against a stock of 200.

Actual output from a local run:

```
requests=500 initialStock=200 succeeded=200 soldOut=300 finalRemaining=0
PASS: no oversell over HTTP, no negative counter, exact accounting.
```

200 succeeded, 300 got clean `409`s, and the Redis counter landed on exactly zero. Both tests run in CI (`.github/workflows/ci.yml`) against a real Redis service container, and the build fails if oversell ever happens.

**A live production run surfaced a real, separate lesson.** Firing 500 truly concurrent requests from a browser at the deployed Render free-tier instance produced 0 visible successes and 500 client-side "no response" errors — the single free container couldn't get HTTP responses back to the browser fast enough under that burst. Checking the source of truth directly told a different story: `orders/count` went up by exactly 500 and `/remaining` landed on exactly 0. Every request had actually been processed correctly server-side — the atomic reservation logic held under real infrastructure stress that the free-tier demo hosting itself couldn't keep up with. The portal originally folded network failures into the "Sold Out" bucket, which misrepresented what happened; it now tracks "No Response" as a distinct outcome from a real `409`, and says explicitly that it isn't proof of a real sold-out. For a live demo on the free tier, keep concurrency around 50–100 — the backend can correctly process far more than that, but the free container can't answer that many callers at once.

## Architecture

```
portal (static HTML/JS)
   |
   |  POST /reserve, GET /remaining         WebSocket: live "remaining" count
   v                                             ^
inventory-service (Express)                 order-service (Express + ws)
   |  Lua EVAL: atomic decrement +               |  XREADGROUP consumer group
   |  XADD, one script  ------------------->     |  INSERT INTO orders (SQLite)
   v                                             v
                    Redis (counter + stream)
```

- **inventory-service** owns the atomic counter and is the only thing that touches it. A successful reservation both decrements the counter and `XADD`s an event (with a UUID reservation ID, not an auto-increment — see idempotency below) to a Redis Stream, inside the same Lua script — see above.
- **order-service** consumes that stream with `XREADGROUP` and a consumer group, not plain `XREAD`. Consumer groups track a pending-entries list (PEL) per consumer, which is what makes at-least-once delivery possible — but only if the consumer actually reads that list back. `XREADGROUP ... '>'` alone only ever returns *new* entries, never a consumer's own unacknowledged backlog from a previous crash, so on startup `consumer.js` explicitly drains the PEL (`XREADGROUP ... '0'`) before switching to `'>'` for new entries. Each event is persisted as an order in SQLite (Node's built-in `node:sqlite`) and only `XACK`'d after the insert succeeds.
- Because delivery is at-least-once, a redelivered event must not create a duplicate order — `reservation_id` is a `UNIQUE` column and inserts use `INSERT OR IGNORE`, so redelivery is a harmless no-op.
- **portal** is deliberately minimal: a live counter (pushed over WebSocket), a "Simulate Rush" button that fires N concurrent `fetch` calls, and a results panel splitting successes from sold-out rejections. The point is watching real concurrency get handled correctly, not the styling.

## Running locally

```bash
brew install redis   # or use Docker if you have it — see below
redis-server --daemonize yes

cd inventory-service && npm install && TICKET_COUNT=20 node src/server.js &
cd order-service && npm install && node --experimental-sqlite src/server.js &
cd portal && node server.js &
```

Then open `http://localhost:4000`.

If Docker is available, `docker-compose up --build` from the repo root brings up Redis and all three services together — the compose file and Dockerfiles were written for it and validated in CI, though this build environment didn't have Docker installed to run it directly (see `DEPLOY.md`).

To reset the counter between runs:

```bash
curl -X POST http://localhost:4001/admin/reset \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: change-me-in-production" \
  -d '{"count": 20}'
```

## Scope, honestly

This is two services and Redis doing two jobs — atomic counter and event stream — not a distributed-systems showcase. There's no Kubernetes, no multi-region failover, no exactly-once delivery (at-least-once + idempotent inserts, which is the standard, simpler answer). SQLite is fine for a single order-service instance; a real deployment with multiple consumers would need Postgres and a proper connection-per-consumer story. The `node:sqlite` module is used instead of `better-sqlite3` because this build environment's Node version couldn't compile `better-sqlite3`'s native bindings — `node:sqlite` sidesteps that entirely and needs no native build step, at the cost of requiring Node ≥ 22.5.

## Deploying

See [DEPLOY.md](DEPLOY.md).
