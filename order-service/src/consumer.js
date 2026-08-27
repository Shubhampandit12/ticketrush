const STREAM_KEY = process.env.STREAM_KEY || 'ticket_reservations';
const CONSUMER_GROUP = process.env.CONSUMER_GROUP || 'order-service-group';
const CONSUMER_NAME = process.env.CONSUMER_NAME || 'order-service-1';
const COUNTER_KEY = 'tickets:remaining';

// Consumer groups (not plain XREAD) give at-least-once delivery: Redis
// tracks a per-consumer pending-entries list (PEL), so a restart mid-stream
// can resume from what's unacknowledged instead of replaying from the start
// or silently skipping ahead — but only if the consumer actually reads its
// PEL back, which is what drainPending below does.
async function ensureConsumerGroup(redis) {
  try {
    await redis.xgroup('CREATE', STREAM_KEY, CONSUMER_GROUP, '0', 'MKSTREAM');
  } catch (err) {
    if (!String(err.message).includes('BUSYGROUP')) throw err;
  }
}

function fieldsToObject(fields) {
  const obj = {};
  for (let i = 0; i < fields.length; i += 2) {
    obj[fields[i]] = fields[i + 1];
  }
  return obj;
}

async function processEntries(entries, onEvent, redis) {
  for (const [streamId, fields] of entries) {
    const event = fieldsToObject(fields);
    await onEvent({ streamId, event });
    await redis.xack(STREAM_KEY, CONSUMER_GROUP, streamId);
  }
}

// Reading with an explicit ID (here '0') instead of '>' returns entries
// already in *this consumer's* PEL — i.e. delivered on a previous run but
// never XACK'd, because the process crashed or was killed before it
// finished persisting them. Redis doesn't replay these automatically on
// XREADGROUP '>'; a consumer has to explicitly ask for its own backlog.
// Draining it here before the main loop is what makes restart-safety real
// rather than just a comment. Reprocessing is safe because onEvent's
// insert is idempotent on reservationId.
async function drainPending(redis, onEvent) {
  while (true) {
    const response = await redis.xreadgroup(
      'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
      'COUNT', 10,
      'STREAMS', STREAM_KEY, '0'
    );
    const entries = response?.[0]?.[1] ?? [];
    if (entries.length === 0) break;
    await processEntries(entries, onEvent, redis);
  }
}

// Runs forever, blocking on new stream entries. `onEvent` persists the
// order; the entry is only XACK'd after that succeeds, so a crash between
// read and persist leaves it in the PEL for drainPending to pick up next
// time this consumer starts.
async function consumeLoop(redis, onEvent, { signal } = {}) {
  await ensureConsumerGroup(redis);
  await drainPending(redis, onEvent);

  while (!signal?.aborted) {
    const response = await redis.xreadgroup(
      'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
      'COUNT', 10,
      'BLOCK', 2000,
      'STREAMS', STREAM_KEY, '>'
    );

    if (!response) continue;

    for (const [, entries] of response) {
      await processEntries(entries, onEvent, redis);
    }
  }
}

async function getRemainingCount(redis) {
  const value = await redis.get(COUNTER_KEY);
  return value === null ? null : Number(value);
}

module.exports = { consumeLoop, ensureConsumerGroup, drainPending, getRemainingCount, STREAM_KEY };
