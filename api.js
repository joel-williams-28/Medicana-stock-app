// api.js
// Frontend API layer for communicating with Netlify Functions

window.api = (function () {
  const GET_ENDPOINT        = '/.netlify/functions/meds-get';
  const ADJUST_ENDPOINT     = '/.netlify/functions/stock-adjust';
  const ADD_MED_ENDPOINT    = '/.netlify/functions/meds-add';
  const ADD_BATCH_ENDPOINT  = '/.netlify/functions/batch-add';
  const LOGIN_ENDPOINT      = '/.netlify/functions/login';

  async function fetchAllData(retries = 3) {
    let lastError;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await fetch(GET_ENDPOINT);
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          const errorMsg = errorData.message || `Server returned ${res.status}`;
          throw new Error(`Failed to load data: ${errorMsg}`);
        }
        return res.json(); // { medications: [...], transactions: [...] }
      } catch (err) {
        lastError = err;
        console.warn(`fetchAllData attempt ${attempt + 1} failed:`, err.message);
        if (attempt < retries - 1) {
          // Wait before retrying (exponential backoff: 1s, 2s, 4s)
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }
    throw lastError;
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
    console.log('[API] Calling transferStock with payload:', payload);
    const res = await fetch('/.netlify/functions/stock-transfer', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    console.log('[API] Transfer response status:', res.status);
    const out = await res.json();
    console.log('[API] Transfer response body:', out);
    if (!res.ok || !out.success) {
      const errorMsg = out.message || 'Transfer failed';
      const debugInfo = out.debug ? JSON.stringify(out.debug) : '';
      const fullError = debugInfo ? `${errorMsg} (Debug: ${debugInfo})` : errorMsg;
      console.error('[API] Transfer failed:', fullError);
      throw new Error(fullError);
    }
    return out;
  }

  async function checkBatch(batchCode) {
    const res = await fetch('/.netlify/functions/batch-check', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ batchCode })
    });
    const out = await res.json();
    if (!res.ok || !out.success) throw new Error(out.message || 'Batch check failed');
    return out;
  }

  async function lookupByBarcode(barcode) {
    const res = await fetch('/.netlify/functions/barcode-lookup', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ barcode })
    });
    const out = await res.json();
    if (!res.ok || !out.success) throw new Error(out.message || 'Lookup failed');
    return out;
  }

  async function setMedicationActive(medicationId, isActive) {
    const res = await fetch('/.netlify/functions/medication-set-active', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ medicationId, isActive })
    });
    const out = await res.json();
    if (!res.ok || !out.success) throw new Error(out.message || 'Set medication active failed');
    return out;
  }

  async function medicationUpsert(payload) {
    const res = await fetch('/.netlify/functions/medication-upsert', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    const out = await res.json();
    if (!res.ok || !out.success) throw new Error(out.message || 'Medication upsert failed');
    return out;
  }

  async function setMedicationMinLevel({ medicationId, minLevel }) {
    const res = await fetch('/.netlify/functions/medication-minlevel-set', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ medicationId, minLevel })
    });
    const out = await res.json();
    if (!res.ok || !out.success) throw new Error(out.message || 'Server error');
    return out;
  }

  async function placeOrder(payload) {
    const res = await fetch('/.netlify/functions/order-place', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    const out = await res.json();
    if (!res.ok || !out.success) throw new Error(out.message || 'Order placement failed');
    return out;
  }

  async function fulfillOrder(orderId) {
    const res = await fetch('/.netlify/functions/order-fulfill', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ orderId })
    });
    const out = await res.json();
    if (!res.ok || !out.success) throw new Error(out.message || 'Order fulfillment failed');
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
    checkBatch,
    lookupByBarcode,
    setMedicationActive,
    medicationUpsert,
    setMedicationMinLevel,
    placeOrder,
    fulfillOrder,
    loginUser,
    startPolling,
    stopPolling
  };
})();

