// netlify/functions/meds-get.js
// Returns all medications (with batches/inventory), recent transactions, locations, and orders
// Uses inventory_full view as the primary source
const db = require('./_db');

exports.handler = async () => {
  try {
    // Query medication/stock snapshot from inventory_full view
    // Include medications with on_hand = 0 if they have pending orders
    const medsResult = await db.query(`
      SELECT DISTINCT ON (medication_id, location_id, batch_id) *
      FROM inventory_full
      WHERE on_hand > 0 OR medication_id IN (
        SELECT medication_id FROM orders WHERE status = 'pending'
      )
      ORDER BY medication_id, location_id, batch_id, medication_name, location_name, expiry_date;
    `);

    // Get medication details (fefo, min_level_boxes, is_active) from medications table
    const medicationDetailsResult = await db.query(`
      SELECT id, name, strength, fefo, min_level_boxes, is_active
      FROM medications
      WHERE is_active = true
    `);

    // Build lookup maps by display_id and internal id
    const medicationDetailsByDisplayId = {};
    const medicationDetailsById = {};
    for (const med of medicationDetailsResult.rows) {
      const displayId = med.strength && med.strength !== 'N/A'
        ? `${med.name} ${med.strength}`
        : med.name;
      const minLevelBoxes = Number.isFinite(Number(med.min_level_boxes)) ? Number(med.min_level_boxes) : 0;
      const details = { internalId: med.id, fefo: med.fefo, minLevelBoxes };
      medicationDetailsByDisplayId[displayId] = details;
      medicationDetailsById[med.id] = { ...details, displayId };
    }

    // Shape into front-end-friendly structure keyed by medicationDisplayId + locationId
    const medsByKey = {};
    for (const row of medsResult.rows) {
      const displayId = row.medication_display_id;
      const locationId = row.location_id;
      const key = `${displayId}|${locationId}`;

      const medDetailsById = row.medication_id ? medicationDetailsById[row.medication_id] : undefined;
      const medDetails = medDetailsById || medicationDetailsByDisplayId[displayId] || {};

      const rawRowMinLevelBoxes = row.min_level_boxes;
      const resolvedMinLevelBoxes = Number.isFinite(Number(rawRowMinLevelBoxes))
        ? Number(rawRowMinLevelBoxes)
        : (medDetails.minLevelBoxes || 0);

      const displayName = row.strength_raw && row.strength_raw !== 'N/A'
        ? `${row.medication_name} ${row.strength_raw}`
        : row.medication_name;

      if (!medsByKey[key]) {
        medsByKey[key] = {
          id: displayId,
          internalId: row.medication_id || medDetails.internalId || null,
          name: displayName,
          medicationName: row.medication_name,
          strength: row.strength_clean || '',
          strengthRaw: row.strength_raw || '',
          medicationDisplayId: displayId,
          minLevelBoxes: resolvedMinLevelBoxes,
          unit: row.type || 'units',
          type: row.type || 'stock',
          location: row.location_name,
          locationId: locationId,
          locationGroup: row.location_group || null,
          barcode: row.barcode || '',
          standardItemsPerBox: null,
          fefo: medDetails.fefo || false,
          batches: []
        };
      }

      // Add batch (only if on_hand > 0)
      if (row.batch_id && row.on_hand > 0) {
        medsByKey[key].batches.push({
          id: row.batch_id,
          quantity: row.on_hand,
          expiryDate: row.expiry_date
            ? new Date(row.expiry_date).toISOString().slice(0, 7)
            : null,
          expiryDateFull: row.expiry_date ? new Date(row.expiry_date).toISOString() : null,
          itemsPerBox: row.items_per_box || null,
          brand: row.brand || '',
          batchNumber: row.batch_code || '',
          numberOfBoxes: row.number_of_boxes || null
        });
      }
    }

    // Calculate total numberOfBoxes per medication
    for (const med of Object.values(medsByKey)) {
      med.numberOfBoxes = med.batches.reduce((sum, b) => sum + (b.numberOfBoxes || 0), 0);
    }

    // Query pending orders
    const ordersResult = await db.query(`
      SELECT
        o.id,
        o.medication_id,
        CASE
          WHEN m.strength IS NULL OR m.strength = 'N/A' THEN m.name
          ELSE m.name || ' ' || m.strength
        END AS med_name,
        o.quantity,
        COALESCE(o.quantity_fulfilled, 0) AS quantity_fulfilled,
        o.urgency,
        o.notes,
        o.pharmacist_email,
        o.status,
        o.ordered_at,
        o.fulfilled_at,
        u.username AS user_name
      FROM orders o
      LEFT JOIN medications m ON m.id = o.medication_id
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.status = 'pending'
      ORDER BY o.ordered_at DESC;
    `);

    const orders = ordersResult.rows.map(row => ({
      id: row.id,
      medId: row.medication_id,
      medName: row.med_name || '',
      quantity: row.quantity,
      quantityFulfilled: row.quantity_fulfilled || 0,
      urgency: row.urgency,
      notes: row.notes || '',
      pharmacistEmail: row.pharmacist_email,
      status: row.status,
      orderedAt: row.ordered_at ? row.ordered_at.toISOString() : new Date().toISOString(),
      fulfilledAt: row.fulfilled_at ? row.fulfilled_at.toISOString() : null,
      user: row.user_name || 'System'
    }));

    // Filter medications: keep if they have batches OR have pending orders
    const medicationIdsWithOrders = new Set(orders.map(o => o.medId));
    const medications = Object.values(medsByKey).filter(med =>
      med.batches.length > 0 || medicationIdsWithOrders.has(med.internalId)
    );

    // Query recent transactions for Activity tab
    const txResult = await db.query(`
      SELECT
        t.id,
        t.medication_id,
        CASE
          WHEN m.strength IS NULL OR m.strength = 'N/A' THEN m.name
          ELSE m.name || ' ' || m.strength
        END AS med_name,
        t.delta,
        t.type,
        t.reason,
        t.location_id,
        l.display_name AS location_name,
        l.group_name AS location_group,
        t.occurred_at,
        u.username AS user_name,
        b.items_per_box,
        b.batch_code
      FROM transactions t
      LEFT JOIN batches b ON b.id = t.batch_id
      LEFT JOIN medications m ON m.id = t.medication_id
      LEFT JOIN locations l ON l.id = t.location_id
      LEFT JOIN users u ON u.id = t.user_id
      ORDER BY t.occurred_at DESC
      LIMIT 200;
    `);

    const transactions = txResult.rows.map(row => {
      let txType = row.type || 'system';

      // Refine type based on reason where applicable
      if (txType === 'in' && row.reason && row.reason.startsWith('Order fulfilled')) {
        txType = 'order_fulfilled';
      }
      // NOTE: Do NOT convert transfer transactions to 'transfer' type here.
      // The frontend pairing logic needs 'in' and 'out' to properly match transfers.

      return {
        id: row.id,
        medId: row.medication_id || null,
        medName: row.med_name || '',
        type: txType,
        amount: Math.abs(row.delta || 0),
        user: row.user_name || 'System',
        location: row.location_name || row.location_id || 'System',
        locationGroup: row.location_group || null,
        timestamp: row.occurred_at
          ? row.occurred_at.toISOString()
          : new Date().toISOString(),
        note: row.reason || '',
        itemsPerBox: row.items_per_box || null,
        batchCode: row.batch_code || null
      };
    });

    // Query all locations for UI dropdowns
    const locationsResult = await db.query(`
      SELECT id, display_name, group_name
      FROM locations
      ORDER BY
        CASE WHEN group_name IS NOT NULL THEN 0 ELSE 1 END,
        group_name,
        display_name;
    `);

    const locations = locationsResult.rows.map(row => ({
      id: row.id,
      displayName: row.display_name,
      groupName: row.group_name
    }));

    // Query pending draft order count for Purchase Orders tab badge
    let draftOrderCount = 0;
    try {
      const draftCountResult = await db.query(
        `SELECT COUNT(*)::int AS count FROM draft_orders WHERE status = 'pending_review'`
      );
      draftOrderCount = draftCountResult.rows[0]?.count || 0;
    } catch (e) {
      // Table may not exist yet
      draftOrderCount = 0;
    }

    return db.json(200, { medications, transactions, locations, orders, draftOrderCount });
  } catch (e) {
    console.error('=== meds-get error ===');
    console.error('Error:', e.message);
    if (e.code) console.error('Code:', e.code);
    if (e.detail) console.error('Detail:', e.detail);

    const isDevelopment = process.env.NODE_ENV !== 'production';
    return db.fail(500,
      isDevelopment ? `Server error: ${e.message}` : 'Server error. Please try again or contact support.',
      isDevelopment && e.code ? { errorCode: e.code } : {}
    );
  }
};
