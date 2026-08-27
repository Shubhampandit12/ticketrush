// Full-stack concurrency proof: fires N simultaneous HTTP requests at a
// running inventory-service and asserts exactly min(N, initial) succeed,
// the rest get clean 409s, and the Redis-backed counter lands exactly on
// zero (or initial - N if N < initial). This is the deliverable proving
// the Lua-script reservation logic holds up through the real HTTP path,
// not just when called directly against Redis.
const BASE_URL = process.env.INVENTORY_URL || 'http://localhost:4001';
const ADMIN_SECRET = process.env.ADMIN_RESET_SECRET || 'change-me-in-production';
const INITIAL_STOCK = Number(process.env.TEST_INITIAL_STOCK || 200);
const CONCURRENT_REQUESTS = Number(process.env.TEST_CONCURRENT_REQUESTS || 500);

async function resetCounter(count) {
  const res = await fetch(`${BASE_URL}/admin/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
    body: JSON.stringify({ count }),
  });
  if (!res.ok) throw new Error(`reset failed: ${res.status}`);
}

async function reserveOnce() {
  const res = await fetch(`${BASE_URL}/reserve`, { method: 'POST' });
  return res.status;
}

async function getRemaining() {
  const res = await fetch(`${BASE_URL}/remaining`);
  const data = await res.json();
  return data.remaining;
}

async function main() {
  await resetCounter(INITIAL_STOCK);

  const calls = Array.from({ length: CONCURRENT_REQUESTS }, () => reserveOnce());
  const statuses = await Promise.all(calls);

  const succeeded = statuses.filter((s) => s === 201).length;
  const soldOut = statuses.filter((s) => s === 409).length;
  const unexpected = statuses.filter((s) => s !== 201 && s !== 409);
  const finalRemaining = await getRemaining();

  const expectedSucceeded = Math.min(CONCURRENT_REQUESTS, INITIAL_STOCK);
  const expectedRemaining = Math.max(0, INITIAL_STOCK - CONCURRENT_REQUESTS);

  console.log(
    `requests=${CONCURRENT_REQUESTS} initialStock=${INITIAL_STOCK} ` +
    `succeeded=${succeeded} soldOut=${soldOut} finalRemaining=${finalRemaining}`
  );

  const failures = [];
  if (succeeded !== expectedSucceeded) {
    failures.push(`expected ${expectedSucceeded} succeeded, got ${succeeded}`);
  }
  if (unexpected.length > 0) {
    failures.push(`unexpected status codes: ${unexpected.join(', ')}`);
  }
  if (finalRemaining < 0) {
    failures.push(`counter went negative: ${finalRemaining}`);
  }
  if (finalRemaining !== expectedRemaining) {
    failures.push(`expected final remaining ${expectedRemaining}, got ${finalRemaining}`);
  }

  if (failures.length > 0) {
    console.error('FAIL:\n' + failures.map((f) => ` - ${f}`).join('\n'));
    process.exit(1);
  }
  console.log('PASS: no oversell over HTTP, no negative counter, exact accounting.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
