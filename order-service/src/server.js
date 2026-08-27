const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { createRedisClient } = require('./redisClient');
const { openDb, insertOrder, countOrders } = require('./db');
const { consumeLoop, getRemainingCount } = require('./consumer');

// PORT takes precedence: hosts like Render inject it and expect the app to
// bind there regardless of app-specific env var names.
const PORT = process.env.PORT || process.env.ORDER_PORT || 4002;

// Separate connections: XREADGROUP BLOCK holds its connection open, so a
// second connection is needed for the ordinary GET calls that report state.
const consumerRedis = createRedisClient();
const queryRedis = createRedisClient();

const db = openDb();
const app = express();

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/orders/count', (req, res) => res.json({ count: countOrders(db) }));

// WebSocket shares the same HTTP server/port as Express (upgraded on the
// /ws path) rather than binding its own port — hosts like Render only
// expose one public port per service, so a second listener would be
// unreachable once deployed.
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(message);
  }
}

wss.on('connection', async (socket) => {
  const remaining = await getRemainingCount(queryRedis);
  socket.send(JSON.stringify({ remaining }));
});

async function handleEvent({ streamId, event }) {
  insertOrder(db, { reservationId: event.reservationId, streamId });
  const remaining = await getRemainingCount(queryRedis);
  broadcast({ remaining, lastOrder: event.reservationId });
}

httpServer.listen(PORT, () => {
  console.log(`order-service HTTP + WebSocket (path /ws) listening on :${PORT}`);
});

consumeLoop(consumerRedis, handleEvent).catch((err) => {
  console.error('consumer loop crashed', err);
  process.exit(1);
});

module.exports = app;
