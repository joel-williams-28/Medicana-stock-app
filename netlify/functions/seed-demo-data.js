// netlify/functions/seed-demo-data.js
// Populates the database with realistic hospital data so every intelligence
// feature lights up during demos. Runs as a Netlify Function.
// All inserts use bulk multi-row VALUES to minimise round-trips to Neon.
// Wrapped in a DB transaction so a timeout/failure rolls back cleanly.

const db = require('./_db');
const bcrypt = require('bcryptjs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  const body = db.parseBody(event);
  const clean = body.clean === true;

  try {
    const result = await seed(clean);
    return db.ok(result);
  } catch (err) {
    console.error('seed-demo-data error:', err);
    return db.fail(500, err.message || 'Seed failed');
  }
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const TODAY = new Date();
TODAY.setHours(12, 0, 0, 0); // Normalize to midday to avoid timezone edge cases
const WEEKS_OF_HISTORY = 12;
const GO_LIVE_DATE = new Date(TODAY);
GO_LIVE_DATE.setDate(GO_LIVE_DATE.getDate() - WEEKS_OF_HISTORY * 7);
const DEMO_PASSWORD = 'Demo123!';

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
const LOCATIONS = [
  { id: 'cupboard-1',      displayName: 'Cupboard 1',          groupName: 'Medication Stock L1' },
  { id: 'cupboard-2',      displayName: 'Cupboard 2',          groupName: 'Medication Stock L1' },
  { id: 'cupboard-3',      displayName: 'Cupboard 3',          groupName: 'Medication Stock L1' },
  { id: 'pacu',            displayName: 'PACU',                 groupName: null },
  { id: 'theatre-1',       displayName: 'Theatre 1',            groupName: 'Theatres' },
  { id: 'theatre-2',       displayName: 'Theatre 2',            groupName: 'Theatres' },
  { id: 'theatre-3',       displayName: 'Theatre 3',            groupName: 'Theatres' },
  { id: 'ward-1',          displayName: 'Ward 1',               groupName: 'Wards' },
  { id: 'ward-2',          displayName: 'Ward 2',               groupName: 'Wards' },
  { id: 'ward-3',          displayName: 'Ward 3',               groupName: 'Wards' },
  { id: 'sapphire-clinic', displayName: 'Sapphire Clinic',      groupName: null },
  { id: 'radiology',       displayName: 'Radiology',            groupName: null },
  { id: 'pharmacy',        displayName: 'Pharmacy',             groupName: null },
];

const USERS = [
  { username: 'ABadiani',   email: 'Aasit.Badiani@Medicana.co.uk', firstName: 'Aasit', fullName: 'Aasit Badiani', role: 'Pharmacist',    location: 'pharmacy' },
  { username: 'DemoAdmin',  email: 'admin@medicana.co.uk',          firstName: 'Admin', fullName: 'Demo Admin',    role: 'Administrator', location: 'pharmacy' },
  { username: 'NurseJones', email: 'jones@medicana.co.uk',          firstName: 'Sarah', fullName: 'Sarah Jones',   role: 'Stock Manager', location: 'ward-1' },
  { username: 'ScrubTech',  email: 'scrub@medicana.co.uk',          firstName: 'Tom',   fullName: 'Tom Davies',    role: 'Stock User',    location: 'theatre-1' },
];

const MEDICATIONS = [
  { id: 'paracetamol-1g',      name: 'Paracetamol',         strength: '1g',          form: 'Tablet',    minBoxes: 6, itemsPerBox: 100, trendRate: 0 },
  { id: 'ibuprofen-400mg',     name: 'Ibuprofen',           strength: '400mg',       form: 'Tablet',    minBoxes: 4, itemsPerBox: 84,  trendRate: 0 },
  { id: 'propofol-200mg',      name: 'Propofol',            strength: '200mg/20ml',  form: 'Injection', minBoxes: 5, itemsPerBox: 5,   trendRate: 0.15 },
  { id: 'fentanyl-100mcg',     name: 'Fentanyl',            strength: '100mcg/2ml',  form: 'Injection', minBoxes: 4, itemsPerBox: 5,   trendRate: 0 },
  { id: 'morphine-10mg',       name: 'Morphine Sulphate',   strength: '10mg/ml',     form: 'Injection', minBoxes: 4, itemsPerBox: 10,  trendRate: -0.10 },
  { id: 'ondansetron-4mg',     name: 'Ondansetron',         strength: '4mg/2ml',     form: 'Injection', minBoxes: 4, itemsPerBox: 5,   trendRate: 0.20 },
  { id: 'midazolam-5mg',       name: 'Midazolam',           strength: '5mg/5ml',     form: 'Injection', minBoxes: 3, itemsPerBox: 10,  trendRate: 0 },
  { id: 'coamoxiclav-625mg',   name: 'Co-amoxiclav',        strength: '625mg',       form: 'Tablet',    minBoxes: 5, itemsPerBox: 21,  trendRate: 0.12 },
  { id: 'metoclopramide-10mg', name: 'Metoclopramide',      strength: '10mg/2ml',    form: 'Injection', minBoxes: 3, itemsPerBox: 10,  trendRate: 0 },
  { id: 'diclofenac-50mg',     name: 'Diclofenac',          strength: '50mg',        form: 'Tablet',    minBoxes: 3, itemsPerBox: 28,  trendRate: -0.15 },
  { id: 'ketamine-200mg',      name: 'Ketamine',            strength: '200mg/20ml',  form: 'Injection', minBoxes: 2, itemsPerBox: 5,   trendRate: 0 },
  { id: 'rocuronium-50mg',     name: 'Rocuronium',          strength: '50mg/5ml',    form: 'Injection', minBoxes: 3, itemsPerBox: 10,  trendRate: 0.10 },
  { id: 'sugammadex-200mg',    name: 'Sugammadex',          strength: '200mg/2ml',   form: 'Injection', minBoxes: 2, itemsPerBox: 10,  trendRate: 0 },
  { id: 'dexamethasone-4mg',   name: 'Dexamethasone',       strength: '4mg/ml',      form: 'Injection', minBoxes: 3, itemsPerBox: 10,  trendRate: 0 },
  { id: 'tranexamic-500mg',    name: 'Tranexamic Acid',     strength: '500mg/5ml',   form: 'Injection', minBoxes: 3, itemsPerBox: 10,  trendRate: 0 },
  { id: 'adrenaline-1mg',      name: 'Adrenaline',          strength: '1mg/1ml',     form: 'Injection', minBoxes: 2, itemsPerBox: 10,  trendRate: 0 },
  { id: 'atropine-600mcg',     name: 'Atropine',            strength: '600mcg/1ml',  form: 'Injection', minBoxes: 2, itemsPerBox: 10,  trendRate: 0 },
  { id: 'saline-1000ml',       name: 'Normal Saline',       strength: '0.9% 1000ml', form: 'IV Fluid',  minBoxes: 8, itemsPerBox: 12,  trendRate: 0 },
  { id: 'hartmanns-1000ml',    name: "Hartmann's Solution", strength: '1000ml',      form: 'IV Fluid',  minBoxes: 4, itemsPerBox: 12,  trendRate: 0 },
  { id: 'lidocaine-1pct-20ml', name: 'Lidocaine',           strength: '1% 20ml',     form: 'Injection', minBoxes: 3, itemsPerBox: 10,  trendRate: 0 },
];

// Base weekly usage in items per location (before trend modification)
const USAGE_PROFILES = {
  'paracetamol-1g':      { 'theatre-1': 30, 'theatre-2': 25, 'theatre-3': 20, 'pacu': 40, 'ward-1': 60, 'ward-2': 50, 'ward-3': 45, 'sapphire-clinic': 15, 'cupboard-1': 10, 'cupboard-2': 8 },
  'ibuprofen-400mg':     { 'ward-1': 30, 'ward-2': 25, 'ward-3': 20, 'sapphire-clinic': 10, 'pacu': 15, 'cupboard-1': 5 },
  'propofol-200mg':      { 'theatre-1': 12, 'theatre-2': 10, 'theatre-3': 8 },
  'fentanyl-100mcg':     { 'theatre-1': 8, 'theatre-2': 7, 'theatre-3': 5, 'pacu': 6 },
  'morphine-10mg':       { 'ward-1': 15, 'ward-2': 12, 'ward-3': 10, 'pacu': 10 },
  'ondansetron-4mg':     { 'theatre-1': 6, 'theatre-2': 5, 'theatre-3': 4, 'pacu': 10 },
  'midazolam-5mg':       { 'theatre-1': 8, 'theatre-2': 6, 'theatre-3': 5 },
  'coamoxiclav-625mg':   { 'ward-1': 30, 'ward-2': 25, 'ward-3': 20, 'sapphire-clinic': 8 },
  'metoclopramide-10mg': { 'pacu': 8, 'ward-1': 6, 'ward-2': 5 },
  'diclofenac-50mg':     { 'ward-1': 14, 'ward-2': 10, 'sapphire-clinic': 8 },
  'ketamine-200mg':      { 'theatre-1': 4, 'theatre-2': 3, 'theatre-3': 2 },
  'rocuronium-50mg':     { 'theatre-1': 8, 'theatre-2': 6, 'theatre-3': 5 },
  'sugammadex-200mg':    { 'theatre-1': 5, 'theatre-2': 4, 'theatre-3': 3 },
  'dexamethasone-4mg':   { 'theatre-1': 6, 'theatre-2': 5, 'theatre-3': 4, 'pacu': 4 },
  'tranexamic-500mg':    { 'theatre-1': 5, 'theatre-2': 4, 'theatre-3': 3 },
  'adrenaline-1mg':      { 'theatre-1': 2, 'pacu': 1, 'ward-1': 1 },
  'atropine-600mcg':     { 'theatre-1': 2, 'theatre-2': 1, 'pacu': 1 },
  'saline-1000ml':       { 'theatre-1': 20, 'theatre-2': 18, 'theatre-3': 15, 'pacu': 12, 'ward-1': 25, 'ward-2': 20, 'ward-3': 18, 'radiology': 8, 'sapphire-clinic': 6 },
  'hartmanns-1000ml':    { 'theatre-1': 12, 'theatre-2': 10, 'theatre-3': 8, 'ward-1': 10, 'ward-2': 8 },
  'lidocaine-1pct-20ml': { 'theatre-1': 5, 'theatre-2': 4, 'radiology': 6, 'sapphire-clinic': 3 },
};

const USAGE_REASONS = {
  theatre:   ['Anaesthesia', 'Intra-operative use', 'Induction', 'Maintenance of anaesthesia', 'Top-up dose'],
  pacu:      ['Post-op use', 'Recovery', 'PONV prophylaxis', 'Pain management', 'Post-operative nausea'],
  ward:      ['Regular dose', 'PRN administration', 'Discharge meds', 'Night-time dose', 'Ward round'],
  sapphire:  ['Pre-op prep', 'Day case', 'Outpatient procedure'],
  radiology: ['Contrast procedure', 'Local anaesthesia', 'Sedation'],
  cupboard:  ['Restocking', 'Emergency use'],
  pharmacy:  ['Supply', 'Dispensing', 'Returned stock'],
};

const BRANDS = {
  Tablet:    ['Accord', 'Teva', 'Mylan', 'Zentiva'],
  Injection: ['Fresenius Kabi', 'B. Braun', 'Hameln', 'Aspen'],
  'IV Fluid': ['Baxter', 'Fresenius Kabi', 'B. Braun'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function getLocCategory(locId) {
  if (locId.startsWith('theatre')) return 'theatre';
  if (locId === 'pacu') return 'pacu';
  if (locId.startsWith('ward')) return 'ward';
  if (locId === 'sapphire-clinic') return 'sapphire';
  if (locId === 'radiology') return 'radiology';
  if (locId.startsWith('cupboard')) return 'cupboard';
  return 'pharmacy';
}

function getReason(locId) {
  return randomChoice(USAGE_REASONS[getLocCategory(locId)] || USAGE_REASONS.pharmacy);
}

function weekdayTs(weekStart, dayOffset) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + dayOffset);
  // Never generate timestamps in the future
  if (d > TODAY) {
    d.setTime(TODAY.getTime());
    d.setHours(7 + randomInt(0, 4), randomInt(0, 59), randomInt(0, 59));
  } else {
    d.setHours(7 + randomInt(0, 11), randomInt(0, 59), randomInt(0, 59));
  }
  return d.toISOString();
}


// ---------------------------------------------------------------------------
// Main seed function — wrapped in a DB transaction for safety
// ---------------------------------------------------------------------------
async function seed(clean) {
  const stats = {};
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // ---- Clean (optional) ----
    if (clean) {
      for (const t of ['activity_log', 'draft_orders', 'orders', 'transactions', 'inventory', 'batches', 'location_min_levels', 'medications', 'users', 'locations', 'intelligence_config']) {
        await client.query(`DELETE FROM ${t}`);
      }
    }

    // ---- 1. Locations (bulk upsert) ----
    {
      const params = [];
      const valueClauses = LOCATIONS.map((l, i) => {
        params.push(l.id, l.displayName, l.groupName);
        return `($${i*3+1}, $${i*3+2}, $${i*3+3})`;
      });
      await client.query(
        `INSERT INTO locations (id, display_name, group_name) VALUES ${valueClauses.join(', ')}
         ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, group_name = EXCLUDED.group_name`,
        params
      );
    }
    stats.locations = LOCATIONS.length;

    // ---- 2. Users ----
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const userIdMap = {};
    for (const u of USERS) {
      const existing = await client.query('SELECT id FROM users WHERE username = $1', [u.username]);
      if (existing.rows.length > 0) {
        userIdMap[u.username] = existing.rows[0].id;
        await client.query(
          'UPDATE users SET password_hash=$1, email=$2, first_name=$3, full_name=$4, role=$5, location=$6, active=true WHERE id=$7',
          [passwordHash, u.email, u.firstName, u.fullName, u.role, u.location, existing.rows[0].id]
        );
      } else {
        const res = await client.query(
          'INSERT INTO users (username, password_hash, email, first_name, full_name, role, active, location) VALUES ($1,$2,$3,$4,$5,$6,true,$7) RETURNING id',
          [u.username, passwordHash, u.email, u.firstName, u.fullName, u.role, u.location]
        );
        userIdMap[u.username] = res.rows[0].id;
      }
    }
    const pharmacistId = userIdMap['ABadiani'];
    stats.users = USERS.length;

    // ---- 3. Medications (bulk) ----
    {
      const cols = ['id', 'name', 'strength', 'form', 'fefo', 'min_level_boxes', 'standard_items_per_box', 'is_active'];
      const params = [];
      const valueClauses = MEDICATIONS.map((m, i) => {
        const off = i * 8;
        params.push(m.id, m.name, m.strength, m.form, true, m.minBoxes, m.itemsPerBox, true);
        return `($${off+1},$${off+2},$${off+3},$${off+4},$${off+5},$${off+6},$${off+7},$${off+8})`;
      });
      await client.query(
        `INSERT INTO medications (${cols.join(',')}) VALUES ${valueClauses.join(',')}
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, strength=EXCLUDED.strength, form=EXCLUDED.form,
         min_level_boxes=EXCLUDED.min_level_boxes, standard_items_per_box=EXCLUDED.standard_items_per_box, is_active=true`,
        params
      );
    }
    stats.medications = MEDICATIONS.length;

    // ---- 4. Batches (bulk — need IDs back for inventory/transactions) ----
    const batchMap = {}; // medId => [{ batchId, itemsPerBox }]
    {
      const batchRows = [];
      for (const med of MEDICATIONS) {
        const numBatches = 2 + (med.id.charCodeAt(0) % 2); // deterministic 2-3
        const brands = BRANDS[med.form] || BRANDS.Injection;
        for (let i = 0; i < numBatches; i++) {
          const expiryMonths = i === 0 ? 3 : (6 + i * 4);
          const expiry = new Date(TODAY);
          expiry.setMonth(expiry.getMonth() + expiryMonths);
          const batchCode = `${med.id.toUpperCase().replace(/-/g, '')}-${String(26 + i)}${String(i + 1).padStart(3, '0')}`;
          batchRows.push({ medId: med.id, batchCode, expiry: expiry.toISOString().slice(0, 10), brand: brands[i % brands.length], ipb: med.itemsPerBox });
        }
      }

      // Bulk insert batches
      const cols = 'medication_id, batch_code, expiry_date, brand, items_per_box';
      const params = [];
      const valueClauses = batchRows.map((b, i) => {
        const off = i * 5;
        params.push(b.medId, b.batchCode, b.expiry, b.brand, b.ipb);
        return `($${off+1},$${off+2},$${off+3},$${off+4},$${off+5})`;
      });

      // Delete existing demo batches first to avoid conflicts, then insert fresh
      const demoBatchCodes = batchRows.map(b => b.batchCode);
      await client.query(`DELETE FROM inventory WHERE batch_id IN (SELECT id FROM batches WHERE batch_code = ANY($1))`, [demoBatchCodes]);
      await client.query(`DELETE FROM transactions WHERE batch_id IN (SELECT id FROM batches WHERE batch_code = ANY($1))`, [demoBatchCodes]);
      await client.query(`DELETE FROM batches WHERE batch_code = ANY($1)`, [demoBatchCodes]);

      await client.query(`INSERT INTO batches (${cols}) VALUES ${valueClauses.join(',')}`, params);

      // Fetch back IDs
      const idRes = await client.query(
        'SELECT id, medication_id, batch_code, items_per_box FROM batches WHERE batch_code = ANY($1) ORDER BY medication_id, expiry_date',
        [demoBatchCodes]
      );
      for (const row of idRes.rows) {
        if (!batchMap[row.medication_id]) batchMap[row.medication_id] = [];
        batchMap[row.medication_id].push({ batchId: row.id, itemsPerBox: row.items_per_box });
      }
    }
    stats.batches = Object.values(batchMap).reduce((s, a) => s + a.length, 0);

    // ---- 5. Inventory (bulk) ----
    {
      const invRows = []; // [locationId, batchId, onHand]

      for (const med of MEDICATIONS) {
        const profile = USAGE_PROFILES[med.id] || {};
        const batches = batchMap[med.id];
        if (!batches || batches.length === 0) continue;

        // Pharmacy: 2-4x min level, split across batches
        const pharmacyBoxes = med.minBoxes * 3;
        const pharmacyItems = pharmacyBoxes * med.itemsPerBox;
        invRows.push(['pharmacy', batches[0].batchId, Math.floor(pharmacyItems * 0.6)]);
        if (batches.length > 1) invRows.push(['pharmacy', batches[1].batchId, pharmacyItems - Math.floor(pharmacyItems * 0.6)]);

        // Cupboards 1-3: buffer stock split across cupboards
        const bufferItems = Math.max(1, Math.floor(med.minBoxes * 0.5)) * med.itemsPerBox;
        const perCupboard = Math.floor(bufferItems / 3);
        const remainder = bufferItems - perCupboard * 3;
        invRows.push(['cupboard-1', batches[0].batchId, perCupboard + remainder]);
        if (perCupboard > 0) {
          invRows.push(['cupboard-2', batches[0].batchId, perCupboard]);
          invRows.push(['cupboard-3', batches[0].batchId, perCupboard]);
        }

        // Per-location stock
        for (const [locId, weeklyUsage] of Object.entries(profile)) {
          const weeksOfSupply = locId.startsWith('theatre') ? 1 : 2;
          const stockItems = Math.max(med.itemsPerBox, weeklyUsage * weeksOfSupply);
          const batchIdx = locId.charCodeAt(locId.length - 1) % batches.length;
          invRows.push([locId, batches[batchIdx].batchId, stockItems]);
        }
      }

      // Deliberate low/zero stock overrides
      const overrides = [
        ['theatre-2', 'propofol-200mg', 2],
        ['pacu', 'ondansetron-4mg', 0],
        ['ward-1', 'coamoxiclav-625mg', 5],
        ['theatre-3', 'rocuronium-50mg', 0],
        ['pharmacy', 'morphine-10mg', 80], // surplus for redistribution
      ];
      for (const [locId, medId, onHand] of overrides) {
        const batches = batchMap[medId];
        if (!batches) continue;
        // Remove existing row for this loc+med, add override
        const batchIds = batches.map(b => b.batchId);
        const existingIdx = invRows.findIndex(r => r[0] === locId && batchIds.includes(r[1]));
        if (existingIdx >= 0) invRows[existingIdx][2] = onHand;
        else invRows.push([locId, batches[0].batchId, onHand]);
      }

      // Deduplicate by (location_id, batch_id) — last value wins
      const invMap = new Map();
      for (const r of invRows) {
        invMap.set(`${r[0]}|${r[1]}`, r);
      }
      const dedupedInv = Array.from(invMap.values());

      // Bulk insert inventory
      const params = [];
      const valueClauses = dedupedInv.map((r, i) => {
        params.push(r[0], r[1], Math.max(0, r[2]));
        return `($${i*3+1},$${i*3+2},$${i*3+3})`;
      });
      await client.query(
        `INSERT INTO inventory (location_id, batch_id, on_hand) VALUES ${valueClauses.join(',')}
         ON CONFLICT (location_id, batch_id) DO UPDATE SET on_hand = EXCLUDED.on_hand`,
        params
      );
      stats.inventory = dedupedInv.length;
    }

    // ---- 6. Transactions — 12 weeks of history (bulk, chunked) ----
    {
      const txRows = []; // [occurred_at, user_id, location_id, batch_id, medication_id, delta, reason, type]

      for (let weekOffset = WEEKS_OF_HISTORY; weekOffset >= 0; weekOffset--) {
        const weekStart = new Date(TODAY);
        weekStart.setDate(weekStart.getDate() - weekOffset * 7);

        for (const med of MEDICATIONS) {
          const profile = USAGE_PROFILES[med.id] || {};
          const batches = batchMap[med.id];
          if (!batches || batches.length === 0) continue;

          for (const [locId, baseUsage] of Object.entries(profile)) {
            const weeksFromStart = WEEKS_OF_HISTORY - weekOffset;
            const trendMultiplier = 1 + (med.trendRate * weeksFromStart);
            const adjustedUsage = Math.max(1, Math.round(baseUsage * trendMultiplier));
            const noise = 1 + (Math.random() * 0.3 - 0.15);
            const weeklyUsage = Math.max(1, Math.round(adjustedUsage * noise));
            const dailyUsage = Math.max(1, Math.round(weeklyUsage / 5));
            const batchId = batches[weekOffset % batches.length].batchId;

            // 5 weekdays of usage (out) — skip future days
            for (let day = 0; day < 5; day++) {
              const dayDate = new Date(weekStart);
              dayDate.setDate(dayDate.getDate() + day);
              if (dayDate > TODAY) break; // Don't generate entries for future dates
              const dayItems = day < 4 ? dailyUsage : Math.max(1, weeklyUsage - dailyUsage * 4);
              txRows.push([weekdayTs(weekStart, day), pharmacistId, locId, batchId, med.id, -dayItems, getReason(locId), 'out']);
            }

            // Weekly delivery to pharmacy (in)
            if (weekOffset > 0) {
              const deliveryItems = Math.round(weeklyUsage * 1.1);
              txRows.push([weekdayTs(weekStart, randomInt(0, 2)), pharmacistId, 'pharmacy', batchId, med.id, deliveryItems, `Delivery received - ${deliveryItems} units`, 'in']);
            }

            // Bi-weekly transfers from Pharmacy to location
            if (weekOffset % 2 === 0 && weekOffset > 0) {
              const transferItems = Math.round(weeklyUsage * 1.5);
              const locName = LOCATIONS.find(l => l.id === locId)?.displayName || locId;
              const ts = weekdayTs(weekStart, randomInt(1, 3));
              txRows.push([ts, pharmacistId, 'pharmacy', batchId, med.id, -transferItems, `Transfer to ${locName}`, 'out']);
              txRows.push([ts, pharmacistId, locId, batchId, med.id, transferItems, 'Transfer from Pharmacy', 'in']);
            }
          }
        }
      }

      // Bulk insert transactions in larger chunks of 500
      const txCols = 'occurred_at, user_id, location_id, batch_id, medication_id, delta, reason, type';
      const colCount = 8;
      for (let i = 0; i < txRows.length; i += 500) {
        const chunk = txRows.slice(i, i + 500);
        const params = [];
        const valueClauses = chunk.map((row, ri) => {
          params.push(...row);
          const off = ri * colCount;
          return `($${off+1},$${off+2},$${off+3},$${off+4},$${off+5},$${off+6},$${off+7},$${off+8})`;
        });
        await client.query(`INSERT INTO transactions (${txCols}) VALUES ${valueClauses.join(',')}`, params);
      }
      stats.transactions = txRows.length;
    }

    // ---- 7. Location min levels (bulk) ----
    {
      const minLevels = [
        ['propofol-200mg', 'theatre-1', 5], ['propofol-200mg', 'theatre-2', 4], ['propofol-200mg', 'theatre-3', 3],
        ['fentanyl-100mcg', 'theatre-1', 4], ['fentanyl-100mcg', 'theatre-2', 3],
        ['ondansetron-4mg', 'pacu', 4], ['ondansetron-4mg', 'theatre-1', 2],
        ['morphine-10mg', 'ward-1', 3], ['morphine-10mg', 'pacu', 3],
        ['rocuronium-50mg', 'theatre-1', 3], ['rocuronium-50mg', 'theatre-2', 2], ['rocuronium-50mg', 'theatre-3', 2],
        ['paracetamol-1g', 'ward-1', 6], ['paracetamol-1g', 'ward-2', 5],
        ['coamoxiclav-625mg', 'ward-1', 4], ['coamoxiclav-625mg', 'ward-2', 3],
        ['saline-1000ml', 'theatre-1', 4], ['saline-1000ml', 'ward-1', 5],
      ];
      const params = [];
      const valueClauses = minLevels.map((ml, i) => {
        params.push(ml[0], ml[1], ml[2], 'ABadiani');
        return `($${i*4+1},$${i*4+2},$${i*4+3},$${i*4+4},NOW())`;
      });
      await client.query(
        `INSERT INTO location_min_levels (medication_id, location_id, min_level_boxes, updated_by, updated_at)
         VALUES ${valueClauses.join(',')}
         ON CONFLICT (medication_id, location_id) DO UPDATE SET min_level_boxes = EXCLUDED.min_level_boxes, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        params
      );
      stats.locationMinLevels = minLevels.length;
    }

    // ---- 8. Intelligence config ----
    await client.query(
      `INSERT INTO intelligence_config (key, value, updated_at) VALUES ('go_live_date', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [GO_LIVE_DATE.toISOString().slice(0, 10)]
    );
    stats.goLiveDate = GO_LIVE_DATE.toISOString().slice(0, 10);

    // ---- 9. Pending orders (bulk) ----
    {
      const orders = [
        ['ondansetron-4mg', 20, 'urgent', 'PACU stock depleted - urgent reorder'],
        ['rocuronium-50mg', 30, 'urgent', 'Theatre 3 out of stock'],
        ['coamoxiclav-625mg', 63, 'routine', 'Ward stock running low'],
      ];
      const params = [];
      const valueClauses = orders.map((o, i) => {
        params.push(o[0], pharmacistId, o[1], o[2], o[3], 'Aasit.Badiani@Medicana.co.uk');
        return `($${i*6+1},$${i*6+2},$${i*6+3},$${i*6+4},$${i*6+5},$${i*6+6},'pending',NOW())`;
      });
      await client.query(
        `INSERT INTO orders (medication_id, user_id, quantity, urgency, notes, pharmacist_email, status, ordered_at)
         VALUES ${valueClauses.join(',')}`,
        params
      );
      stats.pendingOrders = orders.length;
    }

    // ---- 10. Activity log — mirror the seeded data ----
    {
      const actRows = []; // [user_id, action_type, entity_type, entity_id, location_id, details, occurred_at]
      const scrubTechId = userIdMap['ScrubTech'];
      const nurseJonesId = userIdMap['NurseJones'];
      const adminId = userIdMap['DemoAdmin'];

      // Pick user based on location context
      const userForLoc = (locId) => {
        if (locId.startsWith('theatre') || locId === 'pacu') return scrubTechId;
        if (locId.startsWith('ward')) return nurseJonesId;
        return pharmacistId;
      };

      // Login entries — one per week for each user
      const allUserIds = [pharmacistId, adminId, nurseJonesId, scrubTechId];
      for (let weekOffset = WEEKS_OF_HISTORY; weekOffset >= 0; weekOffset--) {
        const weekStart = new Date(TODAY);
        weekStart.setDate(weekStart.getDate() - weekOffset * 7);
        for (const uid of allUserIds) {
          const ts = weekdayTs(weekStart, randomInt(0, 4));
          actRows.push([uid, 'login', null, null, null, JSON.stringify({ ip: '10.0.1.' + randomInt(10, 250) }), ts]);
        }
      }

      // Stock in/out — one summary entry per medication per location per week
      for (let weekOffset = WEEKS_OF_HISTORY; weekOffset >= 0; weekOffset--) {
        const weekStart = new Date(TODAY);
        weekStart.setDate(weekStart.getDate() - weekOffset * 7);

        for (const med of MEDICATIONS) {
          const profile = USAGE_PROFILES[med.id] || {};
          const batches = batchMap[med.id];
          if (!batches || batches.length === 0) continue;
          const batchId = batches[weekOffset % batches.length].batchId;

          for (const [locId, baseUsage] of Object.entries(profile)) {
            const weeksFromStart = WEEKS_OF_HISTORY - weekOffset;
            const trendMultiplier = 1 + (med.trendRate * weeksFromStart);
            const adjustedUsage = Math.max(1, Math.round(baseUsage * trendMultiplier));
            const noise = 1 + (Math.random() * 0.3 - 0.15);
            const weeklyUsage = Math.max(1, Math.round(adjustedUsage * noise));
            const actUserId = userForLoc(locId);

            // Stock out activity (usage)
            actRows.push([
              actUserId, 'stock_out', 'medication', med.id, locId,
              JSON.stringify({ medicationName: med.name, batchId, delta: -weeklyUsage, reason: getReason(locId), weekSummary: true }),
              weekdayTs(weekStart, randomInt(0, 4))
            ]);

            // Stock in activity (delivery to pharmacy)
            if (weekOffset > 0) {
              const deliveryItems = Math.round(weeklyUsage * 1.1);
              actRows.push([
                pharmacistId, 'stock_in', 'medication', med.id, 'pharmacy',
                JSON.stringify({ medicationName: med.name, batchId, delta: deliveryItems, reason: `Delivery received - ${deliveryItems} units` }),
                weekdayTs(weekStart, randomInt(0, 2))
              ]);
            }

            // Transfer activity (bi-weekly)
            if (weekOffset % 2 === 0 && weekOffset > 0) {
              const transferItems = Math.round(weeklyUsage * 1.5);
              const locName = LOCATIONS.find(l => l.id === locId)?.displayName || locId;
              const ts = weekdayTs(weekStart, randomInt(1, 3));
              actRows.push([
                actUserId, 'stock_transfer', 'medication', med.id, locId,
                JSON.stringify({ medicationName: med.name, batchId, delta: transferItems, sourceLocationName: 'Pharmacy', targetLocationName: locName }),
                ts
              ]);
            }
          }
        }
      }

      // Min level changed entries
      const minLevels = [
        ['propofol-200mg', 'theatre-1', 5], ['propofol-200mg', 'theatre-2', 4], ['propofol-200mg', 'theatre-3', 3],
        ['fentanyl-100mcg', 'theatre-1', 4], ['fentanyl-100mcg', 'theatre-2', 3],
        ['ondansetron-4mg', 'pacu', 4], ['ondansetron-4mg', 'theatre-1', 2],
        ['morphine-10mg', 'ward-1', 3], ['morphine-10mg', 'pacu', 3],
        ['rocuronium-50mg', 'theatre-1', 3], ['rocuronium-50mg', 'theatre-2', 2], ['rocuronium-50mg', 'theatre-3', 2],
        ['paracetamol-1g', 'ward-1', 6], ['paracetamol-1g', 'ward-2', 5],
        ['coamoxiclav-625mg', 'ward-1', 4], ['coamoxiclav-625mg', 'ward-2', 3],
        ['saline-1000ml', 'theatre-1', 4], ['saline-1000ml', 'ward-1', 5],
      ];
      for (const [medId, locId, minBoxes] of minLevels) {
        const med = MEDICATIONS.find(m => m.id === medId);
        const loc = LOCATIONS.find(l => l.id === locId);
        const weeksAgo = randomInt(2, 8);
        const ts = new Date(TODAY);
        ts.setDate(ts.getDate() - weeksAgo * 7 + randomInt(0, 4));
        ts.setHours(9 + randomInt(0, 8), randomInt(0, 59), 0);
        actRows.push([
          pharmacistId, 'min_level_changed', 'medication', medId, locId,
          JSON.stringify({ medicationName: med?.name || medId, oldMinLevel: med?.minBoxes || 0, newMinLevel: minBoxes, locationId: locId, locationName: loc?.displayName || locId }),
          ts.toISOString()
        ]);
      }

      // Order placed entries
      const orderEntries = [
        ['ondansetron-4mg', 20, 'urgent', 'PACU stock depleted - urgent reorder'],
        ['rocuronium-50mg', 30, 'urgent', 'Theatre 3 out of stock'],
        ['coamoxiclav-625mg', 63, 'routine', 'Ward stock running low'],
      ];
      for (const [medId, qty, urgency, notes] of orderEntries) {
        const med = MEDICATIONS.find(m => m.id === medId);
        const ts = new Date(TODAY);
        ts.setDate(ts.getDate() - randomInt(1, 5));
        ts.setHours(10 + randomInt(0, 6), randomInt(0, 59), 0);
        actRows.push([
          pharmacistId, 'order_placed', 'medication', medId, null,
          JSON.stringify({ medicationName: med?.name || medId, quantity: qty, urgency, notes, pharmacistEmail: 'Aasit.Badiani@Medicana.co.uk' }),
          ts.toISOString()
        ]);
      }

      // Bulk insert activity logs in chunks of 500
      const actCols = 'user_id, action_type, entity_type, entity_id, location_id, details, occurred_at';
      const actColCount = 7;
      for (let i = 0; i < actRows.length; i += 500) {
        const chunk = actRows.slice(i, i + 500);
        const params = [];
        const valueClauses = chunk.map((row, ri) => {
          params.push(...row);
          const off = ri * actColCount;
          return `($${off+1},$${off+2},$${off+3},$${off+4},$${off+5},$${off+6},$${off+7})`;
        });
        await client.query(`INSERT INTO activity_log (${actCols}) VALUES ${valueClauses.join(',')}`, params);
      }
      stats.activityLogEntries = actRows.length;
    }

    // ---- COMMIT — all or nothing ----
    await client.query('COMMIT');

    stats.maturityWeeks = WEEKS_OF_HISTORY;
    stats.loginUsername = 'ABadiani';
    stats.loginPassword = DEMO_PASSWORD;
    return stats;

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
