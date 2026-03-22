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

  async function fetchActivityLog(params = {}) {
    const qs = new URLSearchParams();
    if (params.actionTypes && params.actionTypes.length > 0) qs.set('action_type', params.actionTypes.join(','));
    if (params.userId) qs.set('user_id', params.userId);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.limit) qs.set('limit', params.limit);
    if (params.beforeId) qs.set('before_id', params.beforeId);
    const res = await fetch(`/.netlify/functions/activity-log?${qs}`);
    const out = await res.json();
    if (!res.ok || !out.success) throw new Error(out.message || 'Failed to fetch activity log');
    return out;
  }

  async function fetchIntelligenceReport(locationId, force = false, nosave = false) {
    let qs = locationId ? `?location_id=${locationId}` : '';
    if (force) qs += (qs ? '&' : '?') + 'force=true';
    if (nosave) qs += (qs ? '&' : '?') + 'nosave=true';
    const res = await fetch(`/.netlify/functions/intelligence-report${qs}`);
    const out = await res.json();
    if (!res.ok || !out.success) throw new Error(out.message || 'Failed to fetch intelligence report');
    return out;
  }

  async function getIntelligenceConfig() {
    const res = await fetch('/.netlify/functions/intelligence-config');
    const out = await res.json();
    if (!res.ok || !out.success) throw new Error(out.message || 'Failed to fetch intelligence config');
    return out;
  }

  return {
    fetchAllData,
    adjustStock:          (payload)  => postJSON('/.netlify/functions/stock-adjust', payload),
    addMedication:        (payload)  => postJSON('/.netlify/functions/meds-add', payload),
    addBatch:             (payload)  => postJSON('/.netlify/functions/batch-add', payload),
    transferStock:        (payload)  => postJSON('/.netlify/functions/stock-transfer', payload),
    checkBatch:           (batchCode) => postJSON('/.netlify/functions/batch-check', { batchCode }),
    lookupByBarcode:      (barcode)  => postJSON('/.netlify/functions/barcode-lookup', { barcode }),
    setMedicationActive:  (payload)  => postJSON('/.netlify/functions/medication-set-active', payload),
    medicationUpsert:     (payload)  => postJSON('/.netlify/functions/medication-upsert', payload),
    setMedicationMinLevel:(payload)  => postJSON('/.netlify/functions/medication-minlevel-set', payload),
    fetchUsers: async () => {
      const res = await fetch('/.netlify/functions/users-list');
      const out = await res.json();
      if (!res.ok || !out.success) throw new Error(out.message || 'Failed to fetch users');
      return out.users;
    },
    setIntelligenceConfig:(payload)  => postJSON('/.netlify/functions/intelligence-config', payload),
    placeOrder:           (payload)  => postJSON('/.netlify/functions/order-place', payload),
    fulfillOrder:         (payload)  => postJSON('/.netlify/functions/order-fulfill', payload),
    generateDraftOrders:  (payload)  => postJSON('/.netlify/functions/draft-orders-generate', payload),
    getDraftOrders:       async (params) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set('status', params.status);
      const res = await fetch(`/.netlify/functions/draft-orders-get?${qs}`);
      const out = await res.json();
      if (!res.ok || !out.success) throw new Error(out.message || 'Failed to fetch draft orders');
      return out;
    },
    actionDraftOrders:    (payload)  => postJSON('/.netlify/functions/draft-orders-action', payload),
    createIntelligenceOrders: (payload) => postJSON('/.netlify/functions/intelligence-orders-create', payload),
    seedDemoData:         (payload)  => postJSON('/.netlify/functions/seed-demo-data', payload || {}),
    fetchIntelligenceReport,
    getIntelligenceConfig,
    postActivityLog:      (payload)  => postJSON('/.netlify/functions/activity-log', payload),
    fetchActivityLog,
    loginUser,
    startPolling,
    stopPolling
  };
})();
