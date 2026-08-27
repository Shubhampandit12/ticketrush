const INVENTORY_URL = window.TICKETRUSH_INVENTORY_URL || 'http://localhost:4001';
const WS_URL = window.TICKETRUSH_WS_URL || 'ws://localhost:4002/ws';

const counterEl = document.getElementById('counter');
const statusEl = document.getElementById('status');
const successEl = document.getElementById('successCount');
const rejectedEl = document.getElementById('rejectedCount');
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

async function simulateRush() {
  const n = Math.max(1, Math.min(5000, Number(nInput.value) || 500));
  rushBtn.disabled = true;
  successEl.textContent = '0';
  rejectedEl.textContent = '0';
  statusEl.textContent = `firing ${n} concurrent requests...`;

  const requests = Array.from({ length: n }, () =>
    fetch(`${INVENTORY_URL}/reserve`, { method: 'POST' })
      .then((res) => res.status === 201)
      .catch(() => false)
  );

  const results = await Promise.all(requests);
  const success = results.filter(Boolean).length;
  const rejected = results.length - success;

  successEl.textContent = success;
  rejectedEl.textContent = rejected;
  statusEl.textContent = `done — ${success} reserved, ${rejected} sold out`;
  rushBtn.disabled = false;
  fetchRemaining();
}

rushBtn.addEventListener('click', simulateRush);
connectWebSocket();
fetchRemaining();
