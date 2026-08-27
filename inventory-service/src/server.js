const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { createRedisClient } = require('./redisClient');
const { reserve, initCounter, getRemaining, RESULT } = require('./reservation');

// PORT takes precedence: hosts like Render inject it and expect the app to
// bind there regardless of app-specific env var names.
const PORT = process.env.PORT || process.env.INVENTORY_PORT || 4001;
const TICKET_COUNT = Number(process.env.TICKET_COUNT || 500);
const STREAM_KEY = process.env.STREAM_KEY || 'ticket_reservations';
const ADMIN_RESET_SECRET = process.env.ADMIN_RESET_SECRET || 'change-me-in-production';
const COUNTER_KEY = 'tickets:remaining';

const redis = createRedisClient();
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

async function ensureCounterInitialized() {
  const current = await getRemaining(redis, COUNTER_KEY);
  if (current === null) {
    await initCounter(redis, COUNTER_KEY, TICKET_COUNT);
  }
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/remaining', async (req, res) => {
  const remaining = await getRemaining(redis, COUNTER_KEY);
  res.json({ remaining });
});

// Thin wrapper: all counting logic lives in reservation.js, already
// covered by its own atomic-under-load test. The reservation id is
// generated before the call and only ever lands in the stream if the
// decrement itself succeeds — the Lua script does both atomically, so
// there's no window where a ticket is decremented with no matching event.
app.post('/reserve', async (req, res) => {
  const reservationId = uuidv4();
  const result = await reserve(redis, COUNTER_KEY, STREAM_KEY, reservationId, Date.now().toString());

  if (result === RESULT.NOT_INITIALIZED) {
    return res.status(503).json({ error: 'inventory not initialized' });
  }
  if (result === RESULT.SOLD_OUT) {
    return res.status(409).json({ error: 'sold out' });
  }

  res.status(201).json({ reservationId, status: 'reserved' });
});

app.post('/admin/reset', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (secret !== ADMIN_RESET_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const count = Number(req.body?.count ?? TICKET_COUNT);
  await initCounter(redis, COUNTER_KEY, count);
  res.json({ status: 'reset', remaining: count });
});

ensureCounterInitialized()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`inventory-service listening on :${PORT}`);
    });
  })
  .catch((err) => {
    console.error('failed to initialize counter', err);
    process.exit(1);
  });

module.exports = app;
