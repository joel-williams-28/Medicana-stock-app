// netlify/functions/seed-demo-data.js
// One-time seed function to populate the database with 1 month of realistic hospital data.
// Call via GET: /.netlify/functions/seed-demo-data
// DELETE THIS FILE after use.

const db = require('./_db');
const { Pool } = require('pg');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return db.methodNotAllowed();
  }

  // Need a dedicated pool/client for long transaction
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ─── Step 1: Clear existing data ───
    await client.query(`
      TRUNCATE activity_log, draft_orders, orders, transactions,
               inventory, location_min_levels, batches, medications
      CASCADE
    `);
    await client.query(`DELETE FROM intelligence_config WHERE key = 'go_live_date'`);

    // ─── Step 2: Query existing users & locations ───
    const { rows: users } = await client.query(
      `SELECT id, username, role, location, first_name FROM users WHERE active = true`
    );
    const { rows: locations } = await client.query(
      `SELECT id, display_name, group_name FROM locations ORDER BY display_name`
    );

    if (users.length === 0) throw new Error('No active users found in database');
    if (locations.length === 0) throw new Error('No locations found in database');

    // Categorize users by role for realistic assignment
    const pharmacists = users.filter(u => u.role === 'Pharmacist' || u.role === 'Administrator');
    const allStaff = users; // everyone can do stock operations
    const pharmacistEmail = pharmacists.length > 0
      ? `${pharmacists[0].first_name || pharmacists[0].username}@medicana.co.uk`
      : 'pharmacy@medicana.co.uk';

    // Categorize locations
    const locMap = {};
    locations.forEach(l => { locMap[l.display_name] = l.id; });
    const locIds = locations.map(l => l.id);

    // Identify location types for medication distribution
    const theatreLocIds = locations.filter(l => (l.group_name || '').toLowerCase().includes('theatre') || (l.display_name || '').toLowerCase().includes('theatre')).map(l => l.id);
    const wardLocIds = locations.filter(l => (l.group_name || '').toLowerCase().includes('ward') || (l.display_name || '').toLowerCase().includes('ward')).map(l => l.id);
    const cupboardLocIds = locations.filter(l => (l.group_name || '').toLowerCase().includes('cupboard') || (l.display_name || '').toLowerCase().includes('stock') || (l.display_name || '').toLowerCase().includes('cupboard')).map(l => l.id);
    const mriLocIds = locations.filter(l => (l.display_name || '').toLowerCase().includes('mri')).map(l => l.id);
    const recoveryLocIds = locations.filter(l => (l.display_name || '').toLowerCase().includes('recovery')).map(l => l.id);

    // Fallbacks: if no specific locations found, use all locations
    const theatres = theatreLocIds.length > 0 ? theatreLocIds : locIds.slice(0, 1);
    const wards = wardLocIds.length > 0 ? wardLocIds : locIds.slice(0, 1);
    const cupboards = cupboardLocIds.length > 0 ? cupboardLocIds : locIds;
    const mriLocs = mriLocIds.length > 0 ? mriLocIds : locIds.slice(0, 1);
    const recoveryLocs = recoveryLocIds.length > 0 ? recoveryLocIds : locIds.slice(0, 1);

    // ─── Step 3: Insert 50 Medications ───
    const medications = [
      // Analgesics & NSAIDs
      { id: 'MED-001', name: 'Paracetamol', strength: '500mg', form: 'Tablet', ipb: 100, min: 5, locs: [...cupboards, ...wards, ...theatres, ...recoveryLocs] },
      { id: 'MED-002', name: 'Paracetamol IV', strength: '1g/100ml', form: 'Fluid bag', ipb: 12, min: 3, locs: [...theatres, ...recoveryLocs, ...wards] },
      { id: 'MED-003', name: 'Ibuprofen', strength: '400mg', form: 'Tablet', ipb: 84, min: 3, locs: [...wards, ...cupboards, ...recoveryLocs] },
      { id: 'MED-004', name: 'Morphine Sulfate', strength: '10mg/ml', form: 'Ampule', ipb: 10, min: 4, locs: [...theatres, ...recoveryLocs, ...wards] },
      { id: 'MED-005', name: 'Codeine Phosphate', strength: '30mg', form: 'Tablet', ipb: 100, min: 3, locs: [...wards, ...cupboards] },
      { id: 'MED-006', name: 'Tramadol', strength: '50mg', form: 'Capsule', ipb: 100, min: 3, locs: [...wards, ...recoveryLocs, ...cupboards] },
      { id: 'MED-007', name: 'Diclofenac', strength: '75mg/3ml', form: 'Ampule', ipb: 10, min: 2, locs: [...theatres, ...recoveryLocs] },
      { id: 'MED-008', name: 'Co-codamol', strength: '30/500mg', form: 'Tablet', ipb: 100, min: 3, locs: [...wards, ...cupboards, ...recoveryLocs] },

      // Anaesthetic Agents
      { id: 'MED-009', name: 'Propofol', strength: '1% 20ml', form: 'Vial', ipb: 5, min: 6, locs: [...theatres] },
      { id: 'MED-010', name: 'Sevoflurane', strength: '250ml', form: 'Liquid', ipb: 1, min: 2, locs: [...theatres] },
      { id: 'MED-011', name: 'Ketamine', strength: '200mg/20ml', form: 'Vial', ipb: 5, min: 3, locs: [...theatres] },
      { id: 'MED-012', name: 'Thiopental Sodium', strength: '500mg', form: 'Vial', ipb: 10, min: 2, locs: [...theatres] },
      { id: 'MED-013', name: 'Lidocaine', strength: '1% 20ml', form: 'Vial', ipb: 10, min: 4, locs: [...theatres, ...cupboards] },
      { id: 'MED-014', name: 'Bupivacaine', strength: '0.5% 20ml', form: 'Vial', ipb: 10, min: 3, locs: [...theatres] },
      { id: 'MED-015', name: 'Desflurane', strength: '240ml', form: 'Liquid', ipb: 1, min: 2, locs: [...theatres] },
      { id: 'MED-016', name: 'Etomidate', strength: '20mg/10ml', form: 'Ampule', ipb: 5, min: 2, locs: [...theatres] },

      // Anaesthesia Adjuncts
      { id: 'MED-017', name: 'Fentanyl', strength: '100mcg/2ml', form: 'Ampule', ipb: 10, min: 5, locs: [...theatres, ...recoveryLocs] },
      { id: 'MED-018', name: 'Remifentanil', strength: '1mg', form: 'Vial', ipb: 5, min: 3, locs: [...theatres] },
      { id: 'MED-019', name: 'Midazolam', strength: '5mg/5ml', form: 'Ampule', ipb: 10, min: 4, locs: [...theatres, ...mriLocs] },
      { id: 'MED-020', name: 'Atracurium', strength: '50mg/5ml', form: 'Ampule', ipb: 10, min: 4, locs: [...theatres] },
      { id: 'MED-021', name: 'Suxamethonium', strength: '100mg/2ml', form: 'Ampule', ipb: 10, min: 3, locs: [...theatres] },
      { id: 'MED-022', name: 'Neostigmine', strength: '2.5mg/ml', form: 'Ampule', ipb: 10, min: 3, locs: [...theatres] },

      // Antiemetics
      { id: 'MED-023', name: 'Ondansetron', strength: '4mg/2ml', form: 'Ampule', ipb: 10, min: 4, locs: [...theatres, ...recoveryLocs, ...wards] },
      { id: 'MED-024', name: 'Cyclizine', strength: '50mg/ml', form: 'Ampule', ipb: 5, min: 3, locs: [...recoveryLocs, ...wards, ...theatres] },
      { id: 'MED-025', name: 'Dexamethasone', strength: '4mg/ml', form: 'Ampule', ipb: 10, min: 3, locs: [...theatres, ...wards] },
      { id: 'MED-026', name: 'Metoclopramide', strength: '10mg/2ml', form: 'Ampule', ipb: 10, min: 2, locs: [...wards, ...recoveryLocs] },

      // Antibiotics
      { id: 'MED-027', name: 'Amoxicillin', strength: '500mg', form: 'Capsule', ipb: 21, min: 4, locs: [...wards, ...cupboards] },
      { id: 'MED-028', name: 'Co-amoxiclav', strength: '1.2g', form: 'Vial', ipb: 10, min: 3, locs: [...wards, ...theatres] },
      { id: 'MED-029', name: 'Flucloxacillin', strength: '500mg', form: 'Capsule', ipb: 28, min: 3, locs: [...wards, ...cupboards] },
      { id: 'MED-030', name: 'Metronidazole', strength: '500mg/100ml', form: 'Fluid bag', ipb: 10, min: 3, locs: [...wards, ...theatres] },
      { id: 'MED-031', name: 'Gentamicin', strength: '80mg/2ml', form: 'Ampule', ipb: 10, min: 2, locs: [...wards, ...theatres] },
      { id: 'MED-032', name: 'Cefuroxime', strength: '750mg', form: 'Vial', ipb: 10, min: 3, locs: [...theatres, ...wards] },

      // Cardiovascular & Emergency
      { id: 'MED-033', name: 'Adrenaline (Epinephrine)', strength: '1mg/ml', form: 'Ampule', ipb: 10, min: 5, locs: [...theatres, ...recoveryLocs, ...wards] },
      { id: 'MED-034', name: 'Atropine', strength: '600mcg/ml', form: 'Ampule', ipb: 10, min: 4, locs: [...theatres, ...recoveryLocs] },
      { id: 'MED-035', name: 'Glycopyrrolate', strength: '200mcg/ml', form: 'Ampule', ipb: 10, min: 3, locs: [...theatres] },
      { id: 'MED-036', name: 'Ephedrine', strength: '30mg/ml', form: 'Ampule', ipb: 10, min: 3, locs: [...theatres] },
      { id: 'MED-037', name: 'Phenylephrine', strength: '10mg/ml', form: 'Ampule', ipb: 5, min: 2, locs: [...theatres] },
      { id: 'MED-038', name: 'Amiodarone', strength: '150mg/3ml', form: 'Ampule', ipb: 10, min: 2, locs: [...theatres, ...recoveryLocs] },

      // MRI Contrast & Sedation
      { id: 'MED-039', name: 'Gadovist (Gadobutrol)', strength: '7.5mmol/15ml', form: 'Pre Filled Syringe', ipb: 5, min: 4, locs: [...mriLocs] },
      { id: 'MED-040', name: 'Lorazepam', strength: '2mg/ml', form: 'Ampule', ipb: 10, min: 2, locs: [...mriLocs, ...wards] },
      { id: 'MED-041', name: 'Chloral Hydrate', strength: '500mg/5ml', form: 'Liquid', ipb: 1, min: 2, locs: [...mriLocs] },

      // Fluids & Electrolytes
      { id: 'MED-042', name: 'Sodium Chloride', strength: '0.9% 1000ml', form: 'Fluid bag', ipb: 12, min: 6, locs: [...theatres, ...wards, ...recoveryLocs, ...cupboards] },
      { id: 'MED-043', name: 'Hartmann\'s Solution', strength: '1000ml', form: 'Fluid bag', ipb: 12, min: 5, locs: [...theatres, ...wards, ...recoveryLocs] },
      { id: 'MED-044', name: 'Glucose', strength: '5% 500ml', form: 'Fluid bag', ipb: 12, min: 4, locs: [...wards, ...recoveryLocs] },
      { id: 'MED-045', name: 'Gelofusine', strength: '500ml', form: 'Fluid bag', ipb: 10, min: 3, locs: [...theatres, ...recoveryLocs] },

      // Ward/Recovery Essentials
      { id: 'MED-046', name: 'Omeprazole', strength: '40mg', form: 'Vial', ipb: 10, min: 3, locs: [...wards, ...cupboards] },
      { id: 'MED-047', name: 'Enoxaparin', strength: '40mg/0.4ml', form: 'Pre Filled Syringe', ipb: 10, min: 4, locs: [...wards, ...theatres] },
      { id: 'MED-048', name: 'Hydrocortisone', strength: '100mg', form: 'Vial', ipb: 10, min: 3, locs: [...theatres, ...wards, ...recoveryLocs] },
      { id: 'MED-049', name: 'Naloxone', strength: '400mcg/ml', form: 'Ampule', ipb: 10, min: 3, locs: [...theatres, ...recoveryLocs] },
      { id: 'MED-050', name: 'Flumazenil', strength: '500mcg/5ml', form: 'Ampule', ipb: 5, min: 2, locs: [...theatres, ...recoveryLocs] },
    ];

    // Bulk insert medications (slug is a generated column - do not insert)
    const medValues = [];
    const medParams = [];
    medications.forEach((med, i) => {
      const off = i * 6;
      medValues.push(`($${off+1}, $${off+2}, $${off+3}, $${off+4}, $${off+5}, $${off+6})`);
      medParams.push(med.id, med.name, med.strength, med.form, med.min, med.ipb);
    });
    await client.query(
      `INSERT INTO medications (id, name, strength, form, min_level_boxes, standard_items_per_box)
       VALUES ${medValues.join(', ')}`,
      medParams
    );

    // ─── Step 4: Insert Batches ───
    const brands = {
      'Tablet': ['Accord', 'Teva', 'Mylan', 'Sandoz'],
      'Capsule': ['Accord', 'Teva', 'Aurobindo', 'Mylan'],
      'Ampule': ['Hameln', 'Martindale', 'Mercury Pharma', 'Accord'],
      'Vial': ['Fresenius Kabi', 'Pfizer', 'Aspen', 'Hameln'],
      'Fluid bag': ['Baxter', 'Fresenius Kabi', 'B. Braun'],
      'Liquid': ['AbbVie', 'Baxter', 'Piramal'],
      'Pre Filled Syringe': ['Sanofi', 'Bayer', 'BD'],
      'Cream': ['GSK', 'Teva'],
      'Patch': ['Janssen', 'Mylan'],
      'Inhaler': ['GSK', 'AstraZeneca'],
      'Suppository': ['Pfizer', 'Teva'],
      'Ointment': ['GSK', 'Teva'],
      'Box Kit': ['BD', 'Medline'],
    };

    let batchCounter = 0;
    const now = new Date('2026-03-20T12:00:00Z');
    const batchData = []; // collect batch info before inserting

    for (const med of medications) {
      const numBatches = 2 + Math.floor(Math.random() * 3); // 2-4 batches
      const formBrands = brands[med.form] || ['Generic Pharma'];

      for (let b = 0; b < numBatches; b++) {
        batchCounter++;
        const batchCode = `BN${String(2025 + Math.floor(b / 2)).slice(-2)}${String(batchCounter).padStart(5, '0')}`;
        const expiryMonths = 3 + Math.floor(Math.random() * 16);
        const expiry = new Date(now);
        expiry.setMonth(expiry.getMonth() + expiryMonths);
        const expiryStr = expiry.toISOString().slice(0, 10);
        const brand = formBrands[b % formBrands.length];
        batchData.push({
          medicationId: med.id, batchCode, expiryStr, brand, ipb: med.ipb,
          serial: `SN-${batchCode}`, locs: med.locs, medName: `${med.name} ${med.strength}`,
        });
      }
    }

    // Single bulk INSERT for all batches
    const batchValues = [];
    const batchParams = [];
    batchData.forEach((b, i) => {
      const off = i * 6;
      batchValues.push(`($${off+1}, $${off+2}, $${off+3}, $${off+4}, $${off+5}, $${off+6})`);
      batchParams.push(b.medicationId, b.batchCode, b.expiryStr, b.brand, b.ipb, b.serial);
    });
    const { rows: returnedBatches } = await client.query(
      `INSERT INTO batches (medication_id, batch_code, expiry_date, brand, items_per_box, serial)
       VALUES ${batchValues.join(', ')} RETURNING id`,
      batchParams
    );
    const batchRows = batchData.map((b, i) => ({
      id: returnedBatches[i].id,
      medicationId: b.medicationId,
      batchCode: b.batchCode,
      ipb: b.ipb,
      medName: b.medName,
      locs: b.locs,
    }));

    // ─── Step 5: Distribute Inventory ───
    // Build inventory records in memory, then bulk insert
    const inventoryRecords = [];
    for (const batch of batchRows) {
      const uniqueLocs = [...new Set(batch.locs)];
      const numLocs = Math.min(uniqueLocs.length, 1 + Math.floor(Math.random() * Math.min(3, uniqueLocs.length)));
      const selectedLocs = shuffle(uniqueLocs).slice(0, numLocs);
      for (const locId of selectedLocs) {
        const boxes = 1 + Math.floor(Math.random() * 8);
        const onHand = boxes * batch.ipb + Math.floor(Math.random() * batch.ipb);
        inventoryRecords.push({ batchId: batch.id, locationId: locId, onHand, medId: batch.medicationId, medName: batch.medName, batchCode: batch.batchCode, ipb: batch.ipb });
      }
    }

    // Single bulk INSERT for inventory
    const invValues = [];
    const invParams = [];
    inventoryRecords.forEach((inv, i) => {
      const off = i * 3;
      invValues.push(`($${off+1}, $${off+2}, $${off+3})`);
      invParams.push(inv.locationId, inv.batchId, inv.onHand);
    });
    await client.query(
      `INSERT INTO inventory (location_id, batch_id, on_hand)
       VALUES ${invValues.join(', ')}
       ON CONFLICT (location_id, batch_id) DO UPDATE SET on_hand = inventory.on_hand + EXCLUDED.on_hand`,
      invParams
    );

    // ─── Step 6: Set location-specific min levels ───
    const minLevelData = [];
    for (const med of medications) {
      const uniqueLocs = [...new Set(med.locs)];
      for (const locId of uniqueLocs) {
        const locMin = Math.max(1, med.min + Math.floor(Math.random() * 3) - 1);
        minLevelData.push({ medId: med.id, locId, locMin });
      }
    }

    // Single bulk INSERT for min levels
    const mlValues = [];
    const mlParams = [];
    const mlDate = new Date('2026-02-18T09:00:00Z');
    minLevelData.forEach((ml, i) => {
      const off = i * 4;
      mlValues.push(`($${off+1}, $${off+2}, $${off+3}, $${off+4})`);
      mlParams.push(ml.medId, ml.locId, ml.locMin, mlDate);
    });
    await client.query(
      `INSERT INTO location_min_levels (medication_id, location_id, min_level_boxes, updated_at)
       VALUES ${mlValues.join(', ')}
       ON CONFLICT (medication_id, location_id) DO UPDATE SET min_level_boxes = EXCLUDED.min_level_boxes`,
      mlParams
    );

    // ─── Step 7: Generate 1 month of transactions ───
    const startDate = new Date('2026-02-18T07:00:00Z');
    const endDate = new Date('2026-03-18T18:00:00Z');
    const transactions = [];
    const activityLogs = [];

    // Helper: random date within range
    function randomDate(start, end) {
      return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
    }

    // Helper: random pick from array
    function pick(arr) {
      return arr[Math.floor(Math.random() * arr.length)];
    }

    // Helper: shuffle array
    function shuffle(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    // Helper: random time during working hours (7am-8pm) on a given date
    function workingHourTime(date) {
      const d = new Date(date);
      d.setHours(7 + Math.floor(Math.random() * 13), Math.floor(Math.random() * 60), Math.floor(Math.random() * 60));
      return d;
    }

    // Generate medication_created activity for the first few days (initial setup)
    const setupDays = [new Date('2026-02-18'), new Date('2026-02-19')];
    for (const med of medications) {
      const setupDate = workingHourTime(pick(setupDays));
      const user = pick(pharmacists.length > 0 ? pharmacists : allStaff);
      activityLogs.push({
        userId: user.id,
        actionType: 'medication_created',
        entityType: 'medication',
        entityId: med.id,
        locationId: null,
        details: { medicationName: `${med.name} ${med.strength}`, form: med.form },
        occurredAt: setupDate,
      });
    }

    // Generate daily transactions for the month
    const dayMs = 24 * 60 * 60 * 1000;
    let currentDay = new Date(startDate);

    const dispensingReasons = [
      'Patient use', 'Patient administration', 'Administered to patient',
      'Pre-op preparation', 'Post-op care', 'Ward round',
      'Emergency use', 'Clinic dispensing', 'Anaesthetic use',
      'Recovery room use', 'MRI sedation', 'Pain management',
    ];

    const deliveryReasons = [
      'Scheduled delivery', 'Weekly restock', 'Supplier delivery',
      'Emergency restock', 'Pharmacy top-up', 'Monthly order delivery',
    ];

    while (currentDay <= endDate) {
      const dayOfWeek = currentDay.getDay(); // 0=Sun, 6=Sat
      const isWeekday = dayOfWeek > 0 && dayOfWeek < 6;
      const isDeliveryDay = dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5; // Mon/Wed/Fri

      // --- Logins: 3-8 per day ---
      const numLogins = isWeekday ? 4 + Math.floor(Math.random() * 5) : 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < numLogins; i++) {
        const user = pick(allStaff);
        const loginTime = workingHourTime(currentDay);
        activityLogs.push({
          userId: user.id,
          actionType: 'login',
          entityType: null,
          entityId: null,
          locationId: user.location || null,
          details: { username: user.username },
          occurredAt: loginTime,
        });
      }

      // --- Stock Out (dispensing): 5-15 per weekday, 2-5 on weekends ---
      const numDispensing = isWeekday ? 5 + Math.floor(Math.random() * 11) : 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < numDispensing; i++) {
        const inv = pick(inventoryRecords);
        const user = pick(allStaff);
        const delta = -(1 + Math.floor(Math.random() * Math.min(5, Math.ceil(inv.ipb / 10))));
        const reason = pick(dispensingReasons);
        const occurredAt = workingHourTime(currentDay);

        transactions.push({
          userId: user.id,
          locationId: inv.locationId,
          batchId: inv.batchId,
          medicationId: inv.medId,
          delta,
          reason,
          type: 'out',
          occurredAt,
        });

        activityLogs.push({
          userId: user.id,
          actionType: 'stock_out',
          entityType: 'medication',
          entityId: inv.medId,
          locationId: inv.locationId,
          details: { medicationName: inv.medName, batchId: inv.batchId, batchCode: inv.batchCode, delta, reason },
          occurredAt,
        });
      }

      // --- Stock In (deliveries): 2-5 on delivery days ---
      if (isDeliveryDay) {
        const numDeliveries = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < numDeliveries; i++) {
          const inv = pick(inventoryRecords);
          const user = pick(pharmacists.length > 0 ? pharmacists : allStaff);
          const boxes = 2 + Math.floor(Math.random() * 6);
          const delta = boxes * inv.ipb;
          const reason = pick(deliveryReasons);
          const occurredAt = workingHourTime(currentDay);

          transactions.push({
            userId: user.id,
            locationId: inv.locationId,
            batchId: inv.batchId,
            medicationId: inv.medId,
            delta,
            reason,
            type: 'in',
            occurredAt,
          });

          activityLogs.push({
            userId: user.id,
            actionType: 'stock_in',
            entityType: 'medication',
            entityId: inv.medId,
            locationId: inv.locationId,
            details: { medicationName: inv.medName, batchId: inv.batchId, batchCode: inv.batchCode, delta, boxes, reason },
            occurredAt,
          });
        }
      }

      // --- Transfers: 1-3 per weekday ---
      if (isWeekday && locIds.length >= 2) {
        const numTransfers = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < numTransfers; i++) {
          const inv = pick(inventoryRecords);
          const user = pick(allStaff);
          const targetLoc = pick(locIds.filter(l => l !== inv.locationId));
          if (!targetLoc) continue;
          const qty = 1 + Math.floor(Math.random() * Math.min(20, inv.ipb));
          const occurredAt = workingHourTime(currentDay);

          // Source: out
          transactions.push({
            userId: user.id,
            locationId: inv.locationId,
            batchId: inv.batchId,
            medicationId: inv.medId,
            delta: -qty,
            reason: `Transfer to ${targetLoc}`,
            type: 'out',
            occurredAt,
          });
          // Target: in
          transactions.push({
            userId: user.id,
            locationId: targetLoc,
            batchId: inv.batchId,
            medicationId: inv.medId,
            delta: qty,
            reason: `Transfer from ${inv.locationId}`,
            type: 'in',
            occurredAt,
          });

          activityLogs.push({
            userId: user.id,
            actionType: 'stock_transfer',
            entityType: 'medication',
            entityId: inv.medId,
            locationId: inv.locationId,
            details: {
              medicationName: inv.medName,
              batchId: inv.batchId,
              batchCode: inv.batchCode,
              quantity: qty,
              sourceLocationId: inv.locationId,
              targetLocationId: targetLoc,
            },
            occurredAt,
          });
        }
      }

      currentDay = new Date(currentDay.getTime() + dayMs);
    }

    // Sort transactions by date for realistic insertion
    transactions.sort((a, b) => a.occurredAt - b.occurredAt);

    // Bulk insert transactions in chunks of 250
    for (let c = 0; c < transactions.length; c += 250) {
      const chunk = transactions.slice(c, c + 250);
      const values = [];
      const params = [];
      chunk.forEach((t, i) => {
        const off = i * 8;
        values.push(`($${off+1}, $${off+2}, $${off+3}, $${off+4}, $${off+5}, $${off+6}, $${off+7}, $${off+8})`);
        params.push(t.userId, t.locationId, t.batchId, t.medicationId, t.delta, t.reason, t.type, t.occurredAt);
      });
      await client.query(
        `INSERT INTO transactions (user_id, location_id, batch_id, medication_id, delta, reason, type, occurred_at)
         VALUES ${values.join(', ')}`,
        params
      );
    }

    // ─── Step 8: Generate Orders ───
    const numOrders = 20 + Math.floor(Math.random() * 11); // 20-30
    const orderData = [];

    for (let i = 0; i < numOrders; i++) {
      const med = pick(medications);
      const user = pick(pharmacists.length > 0 ? pharmacists : allStaff);
      const urgencyRoll = Math.random();
      const urgency = urgencyRoll < 0.7 ? 'routine' : urgencyRoll < 0.9 ? 'urgent' : 'emergency';
      const statusRoll = Math.random();
      const status = statusRoll < 0.6 ? 'fulfilled' : statusRoll < 0.85 ? 'pending' : 'cancelled';
      const orderedAt = randomDate(startDate, endDate);
      const quantity = (2 + Math.floor(Math.random() * 8)) * med.ipb;
      const fulfilledAt = status === 'fulfilled' ? new Date(orderedAt.getTime() + (1 + Math.random() * 5) * dayMs) : null;
      const notes = status === 'fulfilled' ? 'Order completed' : urgency === 'emergency' ? 'Urgent clinical need' : 'Regular restock';
      orderData.push({ med, user, urgency, status, orderedAt, quantity, fulfilledAt, notes });
    }

    // Single bulk INSERT for orders
    const ordValues = [];
    const ordParams = [];
    orderData.forEach((o, i) => {
      const off = i * 10;
      ordValues.push(`($${off+1}, $${off+2}, $${off+3}, $${off+4}, $${off+5}, $${off+6}, $${off+7}, $${off+8}, $${off+9}, $${off+10})`);
      ordParams.push(
        o.med.id, o.user.id, o.quantity, o.urgency, o.notes,
        pharmacistEmail, o.status, o.orderedAt, o.fulfilledAt,
        o.status === 'fulfilled' ? o.quantity : 0
      );
    });
    const { rows: returnedOrders } = await client.query(
      `INSERT INTO orders (medication_id, user_id, quantity, urgency, notes, pharmacist_email, status, ordered_at, fulfilled_at, quantity_fulfilled)
       VALUES ${ordValues.join(', ')} RETURNING id`,
      ordParams
    );

    // Build activity logs from returned order IDs
    orderData.forEach((o, i) => {
      const orderId = returnedOrders[i].id;
      activityLogs.push({
        userId: o.user.id,
        actionType: 'order_placed',
        entityType: 'medication',
        entityId: o.med.id,
        locationId: null,
        details: { medicationName: `${o.med.name} ${o.med.strength}`, quantity: o.quantity, urgency: o.urgency, orderId },
        occurredAt: o.orderedAt,
      });
      if (o.status === 'fulfilled') {
        activityLogs.push({
          userId: o.user.id,
          actionType: 'order_fulfilled',
          entityType: 'medication',
          entityId: o.med.id,
          locationId: null,
          details: { medicationName: `${o.med.name} ${o.med.strength}`, quantity: o.quantity, orderId },
          occurredAt: o.fulfilledAt,
        });
      }
    });

    // Add a handful of min_level_changed activity logs
    for (let i = 0; i < 8; i++) {
      const med = pick(medications);
      const user = pick(pharmacists.length > 0 ? pharmacists : allStaff);
      const occurredAt = randomDate(new Date('2026-02-20'), new Date('2026-03-10'));
      activityLogs.push({
        userId: user.id,
        actionType: 'min_level_changed',
        entityType: 'medication',
        entityId: med.id,
        locationId: pick(med.locs),
        details: { medicationName: `${med.name} ${med.strength}`, oldMin: med.min, newMin: med.min + 1 },
        occurredAt,
      });
    }

    // ─── Step 9: Insert Activity Logs ───
    // Sort by date
    activityLogs.sort((a, b) => a.occurredAt - b.occurredAt);

    // Bulk insert activity logs in chunks of 250
    for (let c = 0; c < activityLogs.length; c += 250) {
      const chunk = activityLogs.slice(c, c + 250);
      const values = [];
      const params = [];
      chunk.forEach((log, i) => {
        const off = i * 7;
        values.push(`($${off+1}, $${off+2}, $${off+3}, $${off+4}, $${off+5}, $${off+6}, $${off+7})`);
        params.push(
          log.userId,
          log.actionType,
          log.entityType || null,
          log.entityId ? String(log.entityId) : null,
          log.locationId || null,
          JSON.stringify(log.details || {}),
          log.occurredAt
        );
      });
      await client.query(
        `INSERT INTO activity_log (user_id, action_type, entity_type, entity_id, location_id, details, occurred_at)
         VALUES ${values.join(', ')}`,
        params
      );
    }

    // ─── Step 10: Set Intelligence Config ───
    await client.query(
      `INSERT INTO intelligence_config (key, value, updated_at)
       VALUES ('go_live_date', '2026-02-18', NOW())
       ON CONFLICT (key) DO UPDATE SET value = '2026-02-18', updated_at = NOW()`
    );

    await client.query('COMMIT');

    // Summary
    return db.ok({
      message: 'Demo data seeded successfully!',
      summary: {
        medications: medications.length,
        batches: batchRows.length,
        inventoryRecords: inventoryRecords.length,
        transactions: transactions.length,
        activityLogs: activityLogs.length,
        orders: numOrders,
        locations: locations.length,
        users: users.length,
        dateRange: `${startDate.toISOString().slice(0,10)} to ${endDate.toISOString().slice(0,10)}`,
        goLiveDate: '2026-02-18',
      },
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed error:', err);
    return db.fail(500, `Seed failed: ${err.message}`);
  } finally {
    client.release();
    await pool.end();
  }
};
