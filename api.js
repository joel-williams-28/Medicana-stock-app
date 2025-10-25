// api.js
// Frontend API layer for communicating with Netlify Functions

window.api = (function () {
  const GET_ENDPOINT        = '/.netlify/functions/meds-get';
  const ADJUST_ENDPOINT     = '/.netlify/functions/stock-adjust';
  const ADD_MED_ENDPOINT    = '/.netlify/functions/meds-add';
  const ADD_BATCH_ENDPOINT  = '/.netlify/functions/batch-add';
  const LOGIN_ENDPOINT      = '/.netlify/functions/login';

  async function fetchAllData() {
    const res = await fetch(GET_ENDPOINT);
    if (!res.ok) throw new Error('Failed to load data');
    return res.json(); // { medications: [...], transactions: [...] }
  }

  async function adjustStock(payload) {
    const res = await fetch(ADJUST_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    const out = await res.json();
    if (!res.ok || !out.success) throw new Error(out.message || 'Stock adjust failed');
    return out;
  }

  async function addMedication(payload) {
    const res = await fetch(ADD_MED_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    const out = await res.json();
    if (!res.ok || !out.success) throw new Error(out.message || 'Add medication failed');
    return out;
  }

  async function addBatch(payload) {
    const res = await fetch(ADD_BATCH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    const out = await res.json();
    if (!res.ok || !out.success) throw new Error(out.message || 'Add batch failed');
    return out;
  }

  async function transferStock(payload) {
    const res = await fetch('/.netlify/functions/stock-transfer', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    const out = await res.json();
    if (!res.ok || !out.success) throw new Error(out.message || 'Transfer failed');
    return out;
  }

  async function loginUser(username, password) {
    const res = await fetch(LOGIN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ username, password })
    });
    return res.json(); // { success:true, user:{...} } or { success:false,...}
  }

  // Polling to keep all clients in sync
  let pollTimer = null;
  function startPolling({ onData, intervalMs = 20000 }) {
    stopPolling();

    // initial load
    fetchAllData()
      .then(onData)
      .catch(err => console.error('initial poll failed', err));

    pollTimer = setInterval(() => {
      fetchAllData()
        .then(onData)
        .catch(err => console.error('poll failed', err));
    }, intervalMs);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  return {
    fetchAllData,
    adjustStock,
    addMedication,
    addBatch,
    transferStock,
    loginUser,
    startPolling,
    stopPolling
  };
})();

