// Direct test of the atomic Lua reservation logic against real Redis,
// with no HTTP layer involved. Fires 500 concurrent calls at an initial
// stock of 100 and asserts: exactly 100 succeed, the rest are sold-out,
// the counter never goes negative, and the stream ends up with exactly
// one entry per successful reservation (proving the decrement and the
// XADD happen as a single atomic operation, not two separate calls).
const { randomUUID } = require('crypto');
const { createRedisClient } = require('../src/redisClient');
const { reserve, initCounter, getRemaining, RESULT } = require('../src/reservation');

const COUNTER_KEY = 'test:tickets:remaining';
const STREAM_KEY = 'test:ticket_reservations';
const INITIAL_STOCK = 100;
const CONCURRENT_CALLS = 500;

async function main() {
  const redis = createRedisClient();
  await initCounter(redis, COUNTER_KEY, INITIAL_STOCK);
  await redis.del(STREAM_KEY);

  const calls = Array.from({ length: CONCURRENT_CALLS }, () =>
    reserve(redis, COUNTER_KEY, STREAM_KEY, randomUUID(), Date.now().toString())
  );
  const results = await Promise.all(calls);

  const reserved = results.filter((r) => r === RESULT.RESERVED).length;
  const soldOut = results.filter((r) => r === RESULT.SOLD_OUT).length;
  const finalRemaining = await getRemaining(redis, COUNTER_KEY);
  const streamLength = await redis.xlen(STREAM_KEY);

  console.log(
    `reserved=${reserved} soldOut=${soldOut} finalRemaining=${finalRemaining} streamLength=${streamLength}`
  );

  const failures = [];
  if (reserved !== Math.min(CONCURRENT_CALLS, INITIAL_STOCK)) {
    failures.push(`expected ${Math.min(CONCURRENT_CALLS, INITIAL_STOCK)} reserved, got ${reserved}`);
  }
  if (reserved + soldOut !== CONCURRENT_CALLS) {
    failures.push(`reserved+soldOut (${reserved + soldOut}) !== total calls (${CONCURRENT_CALLS})`);
  }
  if (finalRemaining < 0) {
    failures.push(`counter went negative: ${finalRemaining}`);
  }
  if (finalRemaining !== 0) {
    failures.push(`expected final remaining 0, got ${finalRemaining}`);
  }
  if (streamLength !== reserved) {
    failures.push(`expected stream length ${reserved} (one entry per reservation), got ${streamLength}`);
  }

  await redis.del(COUNTER_KEY, STREAM_KEY);
  await redis.quit();

  if (failures.length > 0) {
    console.error('FAIL:\n' + failures.map((f) => ` - ${f}`).join('\n'));
    process.exit(1);
  }
  console.log('PASS: no oversell, no negative counter, exact accounting, decrement and XADD stayed in lockstep.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
