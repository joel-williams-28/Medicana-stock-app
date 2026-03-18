// api.js
// Frontend API layer for communicating with Netlify Functions

window.api = (function () {
  // Shared helper for POST requests with standard error handling
  async function postJSON(endpoint, payload) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const out = await res.json();
    if (!res.ok || !out.success) {
      throw new Error(out.message || `Request to ${endpoint} failed`);
    }
    return out;
  }

  async function fetchAllData(retries = 3) {
    let lastError;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await fetch('/.netlify/functions/meds-get');
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(`Failed to load data: ${errorData.message || `Server returned ${res.status}`}`);
        }
        return res.json();
      } catch (err) {
        lastError = err;
        console.warn(`fetchAllData attempt ${attempt + 1} failed:`, err.message);
        if (attempt < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }
    throw lastError;
  }

  async function loginUser(username, password) {
    const res = await fetch('/.netlify/functions/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    return res.json(); // Returns { success, user } or { success: false, ... }
  }

  // Polling to keep all clients in sync
  let pollTimer = null;
  function startPolling({ onData, intervalMs = 20000 }) {
    stopPolling();

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
    adjustStock:          (payload)  => postJSON('/.netlify/functions/stock-adjust', payload),
    addMedication:        (payload)  => postJSON('/.netlify/functions/meds-add', payload),
    addBatch:             (payload)  => postJSON('/.netlify/functions/batch-add', payload),
    transferStock:        (payload)  => postJSON('/.netlify/functions/stock-transfer', payload),
    checkBatch:           (batchCode) => postJSON('/.netlify/functions/batch-check', { batchCode }),
    lookupByBarcode:      (barcode)  => postJSON('/.netlify/functions/barcode-lookup', { barcode }),
    setMedicationActive:  (medicationId, isActive) => postJSON('/.netlify/functions/medication-set-active', { medicationId, isActive }),
    medicationUpsert:     (payload)  => postJSON('/.netlify/functions/medication-upsert', payload),
    setMedicationMinLevel:(payload)  => postJSON('/.netlify/functions/medication-minlevel-set', payload),
    placeOrder:           (payload)  => postJSON('/.netlify/functions/order-place', payload),
    fulfillOrder:         (orderId)  => postJSON('/.netlify/functions/order-fulfill', { orderId }),
    loginUser,
    startPolling,
    stopPolling
  };
})();
