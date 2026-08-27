const fs = require('fs');
const path = require('path');

const RESERVATION_SCRIPT = fs.readFileSync(
  path.join(__dirname, 'reservation.lua'),
  'utf8'
);

// Registers the atomic reserve-decrement-and-record as a Redis custom
// command. ioredis caches the script server-side (EVALSHA) after the first
// call.
function attachReservationCommand(redis) {
  if (!redis.reserveTicket) {
    redis.defineCommand('reserveTicket', {
      numberOfKeys: 2,
      lua: RESERVATION_SCRIPT,
    });
  }
  return redis;
}

const RESULT = {
  SOLD_OUT: 0,
  RESERVED: 1,
  NOT_INITIALIZED: -1,
};

// Thin, well-tested wrapper around the atomic Lua call. Returns one of
// RESULT.RESERVED / RESULT.SOLD_OUT / RESULT.NOT_INITIALIZED. On RESERVED,
// the stream event has already been written by the same atomic operation.
async function reserve(redis, counterKey, streamKey, reservationId, timestamp) {
  attachReservationCommand(redis);
  const result = await redis.reserveTicket(counterKey, streamKey, reservationId, timestamp);
  return result;
}

async function initCounter(redis, counterKey, count) {
  await redis.set(counterKey, count);
}

async function getRemaining(redis, counterKey) {
  const value = await redis.get(counterKey);
  return value === null ? null : Number(value);
}

module.exports = { reserve, initCounter, getRemaining, RESULT, attachReservationCommand };
