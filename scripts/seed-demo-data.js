#!/usr/bin/env node
/**
 * Demo Seed Script for Medicana Stock App
 *
 * Populates the Neon database with realistic hospital data so every
 * intelligence feature (trends, confidence, pipeline, FEFO, drafts)
 * lights up during demos.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/seed-demo-data.js
 *   node scripts/seed-demo-data.js --clean   # Wipe and re-seed
 */

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: true
});

const query = (text, params) => pool.query(text, params);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const TODAY = new Date('2026-03-21');
const WEEKS_OF_HISTORY = 12;
const GO_LIVE_DATE = new Date(TODAY);
GO_LIVE_DATE.setDate(GO_LIVE_DATE.getDate() - WEEKS_OF_HISTORY * 7);

const DEMO_PASSWORD = 'Demo123!';

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
const LOCATIONS = [
  { id: 'med-stock-l1',    displayName: 'Medication Stock L1', groupName: null },
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
  { username: 'ABadiani',    email: 'Aasit.Badiani@Medicana.co.uk', firstName: 'Aasit',  fullName: 'Aasit Badiani',  role: 'Pharmacist',     location: 'pharmacy' },
  { username: 'DemoAdmin',   email: 'admin@medicana.co.uk',          firstName: 'Admin',  fullName: 'Demo Admin',     role: 'Administrator',  location: 'pharmacy' },
  { username: 'NurseJones',  email: 'jones@medicana.co.uk',          firstName: 'Sarah',  fullName: 'Sarah Jones',    role: 'Stock Manager',  location: 'ward-1' },
  { username: 'ScrubTech',   email: 'scrub@medicana.co.uk',          firstName: 'Tom',    fullName: 'Tom Davies',     role: 'Stock User',     location: 'theatre-1' },
];

// trend: 'increasing' | 'decreasing' | 'stable'
// trendRate: weekly % change (positive = increase, negative = decrease)
const MEDICATIONS = [
  { id: 'paracetamol-1g',       name: 'Paracetamol',        strength: '1g',       form: 'Tablet',    minBoxes: 6, itemsPerBox: 100, trend: 'stable',     trendRate: 0 },
  { id: 'ibuprofen-400mg',      name: 'Ibuprofen',          strength: '400mg',    form: 'Tablet',    minBoxes: 4, itemsPerBox: 84,  trend: 'stable',     trendRate: 0 },
  { id: 'propofol-200mg',       name: 'Propofol',           strength: '200mg/20ml', form: 'Injection', minBoxes: 5, itemsPerBox: 5,  trend: 'increasing', trendRate: 0.15 },
  { id: 'fentanyl-100mcg',      name: 'Fentanyl',           strength: '100mcg/2ml', form: 'Injection', minBoxes: 4, itemsPerBox: 5,  trend: 'stable',     trendRate: 0 },
  { id: 'morphine-10mg',        name: 'Morphine Sulphate',  strength: '10mg/ml',  form: 'Injection',  minBoxes: 4, itemsPerBox: 10, trend: 'decreasing', trendRate: -0.10 },
  { id: 'ondansetron-4mg',      name: 'Ondansetron',        strength: '4mg/2ml',  form: 'Injection',  minBoxes: 4, itemsPerBox: 5,  trend: 'increasing', trendRate: 0.20 },
  { id: 'midazolam-5mg',        name: 'Midazolam',          strength: '5mg/5ml',  form: 'Injection',  minBoxes: 3, itemsPerBox: 10, trend: 'stable',     trendRate: 0 },
  { id: 'coamoxiclav-625mg',    name: 'Co-amoxiclav',       strength: '625mg',    form: 'Tablet',     minBoxes: 5, itemsPerBox: 21, trend: 'increasing', trendRate: 0.12 },
  { id: 'metoclopramide-10mg',  name: 'Metoclopramide',     strength: '10mg/2ml', form: 'Injection',  minBoxes: 3, itemsPerBox: 10, trend: 'stable',     trendRate: 0 },
  { id: 'diclofenac-50mg',      name: 'Diclofenac',         strength: '50mg',     form: 'Tablet',     minBoxes: 3, itemsPerBox: 28, trend: 'decreasing', trendRate: -0.15 },
  { id: 'ketamine-200mg',       name: 'Ketamine',           strength: '200mg/20ml', form: 'Injection', minBoxes: 2, itemsPerBox: 5, trend: 'stable',     trendRate: 0 },
  { id: 'rocuronium-50mg',      name: 'Rocuronium',         strength: '50mg/5ml', form: 'Injection',  minBoxes: 3, itemsPerBox: 10, trend: 'increasing', trendRate: 0.10 },
  { id: 'sugammadex-200mg',     name: 'Sugammadex',         strength: '200mg/2ml', form: 'Injection', minBoxes: 2, itemsPerBox: 10, trend: 'stable',     trendRate: 0 },
  { id: 'dexamethasone-4mg',    name: 'Dexamethasone',      strength: '4mg/ml',   form: 'Injection',  minBoxes: 3, itemsPerBox: 10, trend: 'stable',     trendRate: 0 },
  { id: 'tranexamic-500mg',     name: 'Tranexamic Acid',    strength: '500mg/5ml', form: 'Injection', minBoxes: 3, itemsPerBox: 10, trend: 'stable',     trendRate: 0 },
  { id: 'adrenaline-1mg',       name: 'Adrenaline',         strength: '1mg/1ml',  form: 'Injection',  minBoxes: 2, itemsPerBox: 10, trend: 'stable',     trendRate: 0 },
  { id: 'atropine-600mcg',      name: 'Atropine',           strength: '600mcg/1ml', form: 'Injection', minBoxes: 2, itemsPerBox: 10, trend: 'stable',    trendRate: 0 },
  { id: 'saline-1000ml',        name: 'Normal Saline',      strength: '0.9% 1000ml', form: 'IV Fluid', minBoxes: 8, itemsPerBox: 12, trend: 'stable',   trendRate: 0 },
  { id: 'hartmanns-1000ml',     name: "Hartmann's Solution", strength: '1000ml',  form: 'IV Fluid',   minBoxes: 4, itemsPerBox: 12, trend: 'stable',    trendRate: 0 },
  { id: 'lidocaine-1pct-20ml',  name: 'Lidocaine',          strength: '1% 20ml',  form: 'Injection',  minBoxes: 3, itemsPerBox: 10, trend: 'stable',    trendRate: 0 },
];

// Base weekly usage in ITEMS per location type (before trend modification)
// Keys: medication id → { locationId: baseWeeklyItems }
const USAGE_PROFILES = {
  'paracetamol-1g':       { 'theatre-1': 30, 'theatre-2': 25, 'theatre-3': 20, 'pacu': 40, 'ward-1': 60, 'ward-2': 50, 'ward-3': 45, 'sapphire-clinic': 15, 'cupboard-1': 10, 'cupboard-2': 8 },
  'ibuprofen-400mg':      { 'ward-1': 30, 'ward-2': 25, 'ward-3': 20, 'sapphire-clinic': 10, 'pacu': 15, 'cupboard-1': 5 },
  'propofol-200mg':       { 'theatre-1': 12, 'theatre-2': 10, 'theatre-3': 8 },
  'fentanyl-100mcg':      { 'theatre-1': 8, 'theatre-2': 7, 'theatre-3': 5, 'pacu': 6 },
  'morphine-10mg':        { 'ward-1': 15, 'ward-2': 12, 'ward-3': 10, 'pacu': 10 },
  'ondansetron-4mg':      { 'theatre-1': 6, 'theatre-2': 5, 'theatre-3': 4, 'pacu': 10 },
  'midazolam-5mg':        { 'theatre-1': 8, 'theatre-2': 6, 'theatre-3': 5 },
  'coamoxiclav-625mg':    { 'ward-1': 30, 'ward-2': 25, 'ward-3': 20, 'sapphire-clinic': 8 },
  'metoclopramide-10mg':  { 'pacu': 8, 'ward-1': 6, 'ward-2': 5 },
  'diclofenac-50mg':      { 'ward-1': 14, 'ward-2': 10, 'sapphire-clinic': 8 },
  'ketamine-200mg':       { 'theatre-1': 4, 'theatre-2': 3, 'theatre-3': 2 },
  'rocuronium-50mg':      { 'theatre-1': 8, 'theatre-2': 6, 'theatre-3': 5 },
  'sugammadex-200mg':     { 'theatre-1': 5, 'theatre-2': 4, 'theatre-3': 3 },
  'dexamethasone-4mg':    { 'theatre-1': 6, 'theatre-2': 5, 'theatre-3': 4, 'pacu': 4 },
  'tranexamic-500mg':     { 'theatre-1': 5, 'theatre-2': 4, 'theatre-3': 3 },
  'adrenaline-1mg':       { 'theatre-1': 2, 'pacu': 1, 'ward-1': 1 },
  'atropine-600mcg':      { 'theatre-1': 2, 'theatre-2': 1, 'pacu': 1 },
  'saline-1000ml':        { 'theatre-1': 20, 'theatre-2': 18, 'theatre-3': 15, 'pacu': 12, 'ward-1': 25, 'ward-2': 20, 'ward-3': 18, 'radiology': 8, 'sapphire-clinic': 6 },
  'hartmanns-1000ml':     { 'theatre-1': 12, 'theatre-2': 10, 'theatre-3': 8, 'ward-1': 10, 'ward-2': 8 },
  'lidocaine-1pct-20ml':  { 'theatre-1': 5, 'theatre-2': 4, 'radiology': 6, 'sapphire-clinic': 3 },
};

// Reasons by location type
const USAGE_REASONS = {
  'theatre':   ['Anaesthesia', 'Intra-operative use', 'Induction', 'Maintenance of anaesthesia', 'Top-up dose'],
  'pacu':      ['Post-op use', 'Recovery', 'PONV prophylaxis', 'Pain management', 'Post-operative nausea'],
  'ward':      ['Regular dose', 'PRN administration', 'Discharge meds', 'Night-time dose', 'Ward round'],
  'sapphire':  ['Pre-op prep', 'Day case', 'Outpatient procedure'],
  'radiology': ['Contrast procedure', 'Local anaesthesia', 'Sedation'],
  'cupboard':  ['Restocking', 'Emergency use'],
  'pharmacy':  ['Supply', 'Dispensing', 'Returned stock'],
};

// Batch brands per medication form
const BRANDS = {
  'Tablet':    ['Accord', 'Teva', 'Mylan', 'Zentiva'],
  'Injection': ['Fresenius Kabi', 'B. Braun', 'Hameln', 'Aspen'],
  'IV Fluid':  ['Baxter', 'Fresenius Kabi', 'B. Braun'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getLocationCategory(locId) {
  if (locId.startsWith('theatre')) return 'theatre';
  if (locId === 'pacu') return 'pacu';
  if (locId.startsWith('ward')) return 'ward';
  if (locId === 'sapphire-clinic') return 'sapphire';
  if (locId === 'radiology') return 'radiology';
  if (locId.startsWith('cupboard')) return 'cupboard';
  return 'pharmacy';
}

function getReason(locId) {
  const cat = getLocationCategory(locId);
  const reasons = USAGE_REASONS[cat] || USAGE_REASONS.pharmacy;
  return randomChoice(reasons);
}

function weekdayTimestamp(weekStart, dayOffset) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + dayOffset);
  // Business hours: 7am-6pm
  d.setHours(7 + randomInt(0, 11), randomInt(0, 59), randomInt(0, 59));
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Main seed
// ---------------------------------------------------------------------------
async function seed() {
  const cleanMode = process.argv.includes('--clean');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (cleanMode) {
      console.log('Cleaning existing data...');
      await client.query('DELETE FROM activity_log');
      await client.query('DELETE FROM draft_orders');
      await client.query('DELETE FROM orders');
      await client.query('DELETE FROM transactions');
      await client.query('DELETE FROM inventory');
      await client.query('DELETE FROM batches');
      await client.query('DELETE FROM location_min_levels');
      await client.query('DELETE FROM medications');
      await client.query('DELETE FROM users');
      await client.query('DELETE FROM locations');
      await client.query('DELETE FROM intelligence_config');
      console.log('  Cleaned all tables.');
    }

    // -----------------------------------------------------------------------
    // 1. Locations
    // -----------------------------------------------------------------------
    console.log('Inserting locations...');
    for (const loc of LOCATIONS) {
      await client.query(
        `INSERT INTO locations (id, display_name, group_name) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET display_name = $2, group_name = $3`,
        [loc.id, loc.displayName, loc.groupName]
      );
    }
    console.log(`  ${LOCATIONS.length} locations upserted.`);

    // -----------------------------------------------------------------------
    // 2. Users
    // -----------------------------------------------------------------------
    console.log('Inserting users...');
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const userIdMap = {};
    for (const u of USERS) {
      // Check if user exists first (username may not have a unique constraint)
      const existing = await client.query('SELECT id FROM users WHERE username = $1', [u.username]);
      let userId;
      if (existing.rows.length > 0) {
        userId = existing.rows[0].id;
        await client.query(
          `UPDATE users SET password_hash = $1, email = $2, first_name = $3, full_name = $4, role = $5, location = $6, active = true WHERE id = $7`,
          [passwordHash, u.email, u.firstName, u.fullName, u.role, u.location, userId]
        );
      } else {
        const res = await client.query(
          `INSERT INTO users (username, password_hash, email, first_name, full_name, role, active, location)
           VALUES ($1, $2, $3, $4, $5, $6, true, $7) RETURNING id`,
          [u.username, passwordHash, u.email, u.firstName, u.fullName, u.role, u.location]
        );
        userId = res.rows[0].id;
      }
      userIdMap[u.username] = userId;
    }
    const pharmacistUserId = userIdMap['ABadiani'];
    console.log(`  ${USERS.length} users upserted. Pharmacist ID: ${pharmacistUserId}`);

    // -----------------------------------------------------------------------
    // 3. Medications
    // -----------------------------------------------------------------------
    console.log('Inserting medications...');
    for (const med of MEDICATIONS) {
      await client.query(
        `INSERT INTO medications (id, name, strength, form, fefo, min_level_boxes, standard_items_per_box, is_active)
         VALUES ($1, $2, $3, $4, true, $5, $6, true)
         ON CONFLICT (id) DO UPDATE SET name = $2, strength = $3, form = $4, min_level_boxes = $5, standard_items_per_box = $6, is_active = true`,
        [med.id, med.name, med.strength, med.form, med.minBoxes, med.itemsPerBox]
      );
    }
    console.log(`  ${MEDICATIONS.length} medications upserted.`);

    // -----------------------------------------------------------------------
    // 4. Batches (2-3 per medication with varied expiry dates)
    // -----------------------------------------------------------------------
    console.log('Inserting batches...');
    const batchMap = {}; // medId => [{ batchId, batchCode, expiryDate, itemsPerBox }]
    let batchCount = 0;

    for (const med of MEDICATIONS) {
      const numBatches = randomInt(2, 3);
      batchMap[med.id] = [];
      const brands = BRANDS[med.form] || BRANDS['Injection'];

      for (let i = 0; i < numBatches; i++) {
        // Expiry: 2 months to 18 months from today
        const expiryMonths = i === 0 ? randomInt(2, 4) : randomInt(6, 18);
        const expiry = new Date(TODAY);
        expiry.setMonth(expiry.getMonth() + expiryMonths);
        const expiryStr = expiry.toISOString().slice(0, 10);

        const batchCode = `${med.id.toUpperCase().replace(/-/g, '')}-${String(2026 + i).slice(2)}${String(i + 1).padStart(3, '0')}`;
        const brand = brands[i % brands.length];

        // Check if batch exists (batch_code may not have unique constraint)
        const existingBatch = await client.query('SELECT id FROM batches WHERE batch_code = $1', [batchCode]);
        let res;
        if (existingBatch.rows.length > 0) {
          await client.query(
            `UPDATE batches SET expiry_date = $1, brand = $2, items_per_box = $3 WHERE batch_code = $4`,
            [expiryStr, brand, med.itemsPerBox, batchCode]
          );
          res = { rows: existingBatch.rows };
        } else {
          res = await client.query(
            `INSERT INTO batches (medication_id, batch_code, expiry_date, brand, items_per_box)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [med.id, batchCode, expiryStr, brand, med.itemsPerBox]
          );
        }

        batchMap[med.id].push({
          batchId: res.rows[0].id,
          batchCode,
          expiryDate: expiryStr,
          itemsPerBox: med.itemsPerBox
        });
        batchCount++;
      }
    }
    console.log(`  ${batchCount} batches upserted.`);

    // -----------------------------------------------------------------------
    // 5. Inventory — distribute stock across locations
    // -----------------------------------------------------------------------
    console.log('Setting up inventory...');
    let inventoryCount = 0;

    // Define which medications go where and approximate stock in boxes
    // Pharmacy always gets the most (central store)
    for (const med of MEDICATIONS) {
      const profile = USAGE_PROFILES[med.id] || {};
      const batches = batchMap[med.id];

      // Pharmacy stock: 2-4x min level (well-stocked central store)
      const pharmacyBoxes = med.minBoxes * randomInt(2, 4);
      // Split across batches — more in the sooner-expiry batch (FEFO demo)
      const pharmacyItems = pharmacyBoxes * med.itemsPerBox;
      const batch1Items = Math.floor(pharmacyItems * 0.6);
      const batch2Items = pharmacyItems - batch1Items;

      await upsertInventory(client, 'pharmacy', batches[0].batchId, batch1Items);
      if (batches.length > 1) {
        await upsertInventory(client, 'pharmacy', batches[1].batchId, batch2Items);
      }
      inventoryCount += batches.length > 1 ? 2 : 1;

      // Med Stock L1: moderate buffer
      const medStockBoxes = Math.max(1, Math.floor(med.minBoxes * 0.5));
      await upsertInventory(client, 'med-stock-l1', batches[0].batchId, medStockBoxes * med.itemsPerBox);
      inventoryCount++;

      // Location-specific stock based on usage profiles
      for (const [locId, weeklyUsage] of Object.entries(profile)) {
        // Stock = roughly 1-3 weeks of supply at each location
        const weeksOfSupply = locId.startsWith('theatre') ? randomInt(1, 2) : randomInt(1, 3);
        const stockItems = Math.max(med.itemsPerBox, weeklyUsage * weeksOfSupply);
        const batchIdx = randomInt(0, batches.length - 1);
        await upsertInventory(client, locId, batches[batchIdx].batchId, stockItems);
        inventoryCount++;
      }
    }

    // Deliberately create LOW STOCK situations for demo
    // Propofol: very low at Theatre 2 (increasing usage eating through stock)
    await setInventoryLevel(client, 'theatre-2', batchMap['propofol-200mg'][0].batchId, 2);
    // Ondansetron: zero at PACU (urgent)
    await setInventoryLevel(client, 'pacu', batchMap['ondansetron-4mg'][0].batchId, 0);
    // Co-amoxiclav: low at Ward 1
    await setInventoryLevel(client, 'ward-1', batchMap['coamoxiclav-625mg'][0].batchId, 5);
    // Rocuronium: zero at Theatre 3 (urgent)
    await setInventoryLevel(client, 'theatre-3', batchMap['rocuronium-50mg'][0].batchId, 0);
    // Morphine: moderate surplus at Pharmacy (redistribution candidate)
    await setInventoryLevel(client, 'pharmacy', batchMap['morphine-10mg'][0].batchId, 80);

    console.log(`  ${inventoryCount} inventory rows set up (with low-stock scenarios).`);

    // -----------------------------------------------------------------------
    // 6. Transactions — 12 weeks of history with engineered trends
    // -----------------------------------------------------------------------
    console.log('Generating 12 weeks of transaction history...');
    let txCount = 0;

    for (let weekOffset = WEEKS_OF_HISTORY; weekOffset >= 0; weekOffset--) {
      const weekStart = new Date(TODAY);
      weekStart.setDate(weekStart.getDate() - weekOffset * 7);

      for (const med of MEDICATIONS) {
        const profile = USAGE_PROFILES[med.id] || {};
        const batches = batchMap[med.id];
        const trendRate = med.trendRate;

        for (const [locId, baseUsage] of Object.entries(profile)) {
          // Apply trend: week 0 = oldest, so trend modifies upward/downward over time
          const weeksFromStart = WEEKS_OF_HISTORY - weekOffset;
          const trendMultiplier = 1 + (trendRate * weeksFromStart);
          const adjustedUsage = Math.max(1, Math.round(baseUsage * trendMultiplier));

          // Add ±15% random noise
          const noise = 1 + (Math.random() * 0.3 - 0.15);
          const weeklyUsage = Math.max(1, Math.round(adjustedUsage * noise));

          // Spread usage across 5 weekdays
          const dailyUsage = Math.max(1, Math.round(weeklyUsage / 5));
          const batchIdx = randomInt(0, batches.length - 1);
          const batchId = batches[batchIdx].batchId;

          for (let day = 0; day < 5; day++) {
            const ts = weekdayTimestamp(weekStart, day);
            const dayItems = day < 4 ? dailyUsage : weeklyUsage - dailyUsage * 4; // ensure total matches
            if (dayItems <= 0) continue;

            // Usage transaction (out)
            await client.query(
              `INSERT INTO transactions (occurred_at, user_id, location_id, batch_id, medication_id, delta, reason, type)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [ts, pharmacistUserId, locId, batchId, med.id, -dayItems, getReason(locId), 'out']
            );
            txCount++;
          }

          // Weekly delivery to pharmacy (inflow to replenish)
          if (weekOffset > 0) { // No delivery in current week
            const deliveryTs = weekdayTimestamp(weekStart, randomInt(0, 2));
            const deliveryItems = Math.round(weeklyUsage * 1.1); // Slightly more than used
            await client.query(
              `INSERT INTO transactions (occurred_at, user_id, location_id, batch_id, medication_id, delta, reason, type)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [deliveryTs, pharmacistUserId, 'pharmacy', batchId, med.id, deliveryItems, `Delivery received - ${deliveryItems} units`, 'in']
            );
            txCount++;
          }

          // Periodic transfers from Pharmacy to the location (every 2 weeks)
          if (weekOffset % 2 === 0 && weekOffset > 0) {
            const transferTs = weekdayTimestamp(weekStart, randomInt(1, 3));
            const transferItems = Math.round(weeklyUsage * 1.5);
            const locDisplayName = LOCATIONS.find(l => l.id === locId)?.displayName || locId;

            // Out from Pharmacy
            await client.query(
              `INSERT INTO transactions (occurred_at, user_id, location_id, batch_id, medication_id, delta, reason, type)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [transferTs, pharmacistUserId, 'pharmacy', batchId, med.id, -transferItems, `Transfer to ${locDisplayName}`, 'out']
            );
            // In to location
            await client.query(
              `INSERT INTO transactions (occurred_at, user_id, location_id, batch_id, medication_id, delta, reason, type)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [transferTs, pharmacistUserId, locId, batchId, med.id, transferItems, 'Transfer from Pharmacy', 'in']
            );
            txCount += 2;
          }
        }
      }
    }
    console.log(`  ${txCount} transactions generated.`);

    // -----------------------------------------------------------------------
    // 7. Location min levels (per-location overrides)
    // -----------------------------------------------------------------------
    console.log('Setting location-specific min levels...');
    const minLevels = [
      { medId: 'propofol-200mg',    locId: 'theatre-1',  min: 5 },
      { medId: 'propofol-200mg',    locId: 'theatre-2',  min: 4 },
      { medId: 'propofol-200mg',    locId: 'theatre-3',  min: 3 },
      { medId: 'fentanyl-100mcg',   locId: 'theatre-1',  min: 4 },
      { medId: 'fentanyl-100mcg',   locId: 'theatre-2',  min: 3 },
      { medId: 'ondansetron-4mg',   locId: 'pacu',       min: 4 },
      { medId: 'ondansetron-4mg',   locId: 'theatre-1',  min: 2 },
      { medId: 'morphine-10mg',     locId: 'ward-1',     min: 3 },
      { medId: 'morphine-10mg',     locId: 'pacu',       min: 3 },
      { medId: 'rocuronium-50mg',   locId: 'theatre-1',  min: 3 },
      { medId: 'rocuronium-50mg',   locId: 'theatre-2',  min: 2 },
      { medId: 'rocuronium-50mg',   locId: 'theatre-3',  min: 2 },
      { medId: 'paracetamol-1g',    locId: 'ward-1',     min: 6 },
      { medId: 'paracetamol-1g',    locId: 'ward-2',     min: 5 },
      { medId: 'coamoxiclav-625mg', locId: 'ward-1',     min: 4 },
      { medId: 'coamoxiclav-625mg', locId: 'ward-2',     min: 3 },
      { medId: 'saline-1000ml',     locId: 'theatre-1',  min: 4 },
      { medId: 'saline-1000ml',     locId: 'ward-1',     min: 5 },
    ];

    for (const ml of minLevels) {
      await client.query(
        `INSERT INTO location_min_levels (medication_id, location_id, min_level_boxes, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (medication_id, location_id) DO UPDATE SET min_level_boxes = $3, updated_by = $4, updated_at = NOW()`,
        [ml.medId, ml.locId, ml.min, 'ABadiani']
      );
    }
    console.log(`  ${minLevels.length} location min levels set.`);

    // -----------------------------------------------------------------------
    // 8. Intelligence config — set go_live_date for mature status
    // -----------------------------------------------------------------------
    console.log('Setting intelligence config...');
    await client.query(
      `INSERT INTO intelligence_config (key, value, updated_at) VALUES ('go_live_date', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [GO_LIVE_DATE.toISOString().slice(0, 10)]
    );
    console.log(`  go_live_date set to ${GO_LIVE_DATE.toISOString().slice(0, 10)} (${WEEKS_OF_HISTORY} weeks ago).`);

    // -----------------------------------------------------------------------
    // 9. Pending orders (for "Order Pending" badges)
    // -----------------------------------------------------------------------
    console.log('Creating pending orders...');
    const pendingOrders = [
      { medId: 'ondansetron-4mg',  qty: 20, urgency: 'urgent',  notes: 'PACU stock depleted - urgent reorder' },
      { medId: 'rocuronium-50mg',  qty: 30, urgency: 'urgent',  notes: 'Theatre 3 out of stock' },
      { medId: 'coamoxiclav-625mg', qty: 63, urgency: 'routine', notes: 'Ward stock running low' },
    ];

    for (const order of pendingOrders) {
      await client.query(
        `INSERT INTO orders (medication_id, user_id, quantity, urgency, notes, pharmacist_email, status, ordered_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())`,
        [order.medId, pharmacistUserId, order.qty, order.urgency, order.notes, 'Aasit.Badiani@Medicana.co.uk']
      );
    }
    console.log(`  ${pendingOrders.length} pending orders created.`);

    // -----------------------------------------------------------------------
    // Commit
    // -----------------------------------------------------------------------
    await client.query('COMMIT');
    console.log('\nDemo data seeded successfully!');
    console.log(`\nSummary:`);
    console.log(`  Locations:          ${LOCATIONS.length}`);
    console.log(`  Users:              ${USERS.length} (password: ${DEMO_PASSWORD})`);
    console.log(`  Medications:        ${MEDICATIONS.length}`);
    console.log(`  Batches:            ${batchCount}`);
    console.log(`  Inventory rows:     ~${inventoryCount}`);
    console.log(`  Transactions:       ${txCount}`);
    console.log(`  Location min levels: ${minLevels.length}`);
    console.log(`  Pending orders:     ${pendingOrders.length}`);
    console.log(`  Maturity:           mature (${WEEKS_OF_HISTORY} weeks)`);
    console.log(`\nLogin: ABadiani / ${DEMO_PASSWORD}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed, rolled back:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// Inventory helpers
// ---------------------------------------------------------------------------
async function upsertInventory(client, locationId, batchId, onHand) {
  await client.query(
    `INSERT INTO inventory (location_id, batch_id, on_hand) VALUES ($1, $2, $3)
     ON CONFLICT (location_id, batch_id) DO UPDATE SET on_hand = $3`,
    [locationId, batchId, Math.max(0, onHand)]
  );
}

async function setInventoryLevel(client, locationId, batchId, onHand) {
  await client.query(
    `INSERT INTO inventory (location_id, batch_id, on_hand) VALUES ($1, $2, $3)
     ON CONFLICT (location_id, batch_id) DO UPDATE SET on_hand = $3`,
    [locationId, batchId, Math.max(0, onHand)]
  );
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
seed().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
