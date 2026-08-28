const INVENTORY_URL = window.TICKETRUSH_INVENTORY_URL || 'http://localhost:4001';
const WS_URL = window.TICKETRUSH_WS_URL || 'ws://localhost:4002/ws';

const counterEl = document.getElementById('counter');
const statusEl = document.getElementById('status');
const successEl = document.getElementById('successCount');
const rejectedEl = document.getElementById('rejectedCount');
const erroredEl = document.getElementById('erroredCount');
const rushBtn = document.getElementById('rush');
const nInput = document.getElementById('n');

function renderCounter(remaining) {
  if (remaining === null || remaining === undefined) return;
  counterEl.textContent = remaining;
  counterEl.classList.toggle('zero', remaining <= 0);
}

function connectWebSocket() {
  const ws = new WebSocket(WS_URL);
  ws.onopen = () => { statusEl.textContent = 'live'; };
  ws.onclose = () => {
    statusEl.textContent = 'disconnected — retrying...';
    setTimeout(connectWebSocket, 1500);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    renderCounter(data.remaining);
  };
}

async function fetchRemaining() {
  try {
    const res = await fetch(`${INVENTORY_URL}/remaining`);
    const data = await res.json();
    renderCounter(data.remaining);
  } catch (err) {
    statusEl.textContent = 'could not reach inventory-service';
  }
}

// Resets stock to the server's fixed default on every page load, so each
// visitor sees a fresh demo regardless of what a previous visitor did.
// Runs before the WebSocket connects / the first /remaining fetch, so the
// very first number anyone sees is already the reset value, not a stale
// one that then jumps. Intended for one viewer at a time — a page load
// from a second visitor while a first is mid-test will rewind their count.
async function resetOnLoad() {
  try {
    await fetch(`${INVENTORY_URL}/demo/reset`, { method: 'POST' });
  } catch (err) {
    // Free-tier cold start or a transient network blip — not fatal, the
    // page still works, it just starts from whatever count was already there.
  }
}

// A request lands in exactly one bucket: the server said yes (201), the
// server said no (409, a real sold-out), or we never got a clean answer at
// all (network error, timeout, non-2xx/409 status). That third bucket is
// not the same claim as "sold out" — the server may well have processed
// the reservation and we just never heard back — so it's tracked and shown
// separately rather than folded into "sold out".
async function reserveOnce() {
  try {
    const res = await fetch(`${INVENTORY_URL}/reserve`, { method: 'POST' });
    if (res.status === 201) return 'reserved';
    if (res.status === 409) return 'soldOut';
    return 'errored';
  } catch (err) {
    return 'errored';
  }
}

async function simulateRush() {
  const n = Math.max(1, Math.min(5000, Number(nInput.value) || 500));
  rushBtn.disabled = true;
  successEl.textContent = '0';
  rejectedEl.textContent = '0';
  erroredEl.textContent = '0';
  statusEl.textContent = `firing ${n} concurrent requests...`;

  const results = await Promise.all(Array.from({ length: n }, reserveOnce));

  const reserved = results.filter((r) => r === 'reserved').length;
  const soldOut = results.filter((r) => r === 'soldOut').length;
  const errored = results.filter((r) => r === 'errored').length;

  successEl.textContent = reserved;
  rejectedEl.textContent = soldOut;
  erroredEl.textContent = errored;
  statusEl.textContent = errored > 0
    ? `done — ${reserved} reserved, ${soldOut} sold out, ${errored} no response (may still have succeeded server-side — check /remaining)`
    : `done — ${reserved} reserved, ${soldOut} sold out`;
  rushBtn.disabled = false;
  fetchRemaining();
}

rushBtn.addEventListener('click', simulateRush);
resetOnLoad().then(() => {
  connectWebSocket();
  fetchRemaining();
});
