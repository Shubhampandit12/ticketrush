const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATABASE_URL = process.env.DATABASE_URL || path.join(__dirname, '..', 'data', 'orders.db');

function openDb() {
  fs.mkdirSync(path.dirname(DATABASE_URL), { recursive: true });
  const db = new DatabaseSync(DATABASE_URL);
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id TEXT NOT NULL UNIQUE,
      stream_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function insertOrder(db, { reservationId, streamId }) {
  // reservation_id is UNIQUE, so a redelivered event from the consumer
  // group (at-least-once delivery) is a harmless no-op, not a duplicate order.
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO orders (reservation_id, stream_id) VALUES (?, ?)'
  );
  return stmt.run(reservationId, streamId);
}

function countOrders(db) {
  return db.prepare('SELECT COUNT(*) AS count FROM orders').get().count;
}

module.exports = { openDb, insertOrder, countOrders };
