// netlify/functions/meds-get.js
// Returns all medications (with batches/inventory), recent transactions, and locations list
// Uses inventory_full view as the primary source
const db = require('./_db');

exports.handler = async () => {
  try {
    // Query medication/stock snapshot from inventory_full view
    // INCLUDE medications with on_hand = 0 if they have pending orders
    // The view returns columns in this exact order:
    // batch_id, location_id, location_name, location_group, medication_name, strength_clean,
    // medication_display_id, barcode, batch_code, brand, expiry_date, on_hand, items_per_box, number_of_boxes
    // Plus helper fields: type (form) and strength_raw
    const medsQuery = `
      SELECT DISTINCT ON (inv.medication_id, inv.location_id, inv.batch_id)
        inv.*,
        COALESCE(lml.min_level_boxes, 0) as location_min_level_boxes
      FROM inventory_full inv
      LEFT JOIN location_min_levels lml
        ON lml.medication_id = inv.medication_id
        AND lml.location_id = inv.location_id
      WHERE inv.on_hand > 0 OR inv.medication_id IN (
        SELECT medication_id FROM orders WHERE status = 'pending'
      )
      ORDER BY inv.medication_id, inv.location_id, inv.batch_id, inv.medication_name, inv.location_name, inv.expiry_date;
    `;
    const medsResult = await db.query(medsQuery);

    // Get medication details (fefo, min_level_boxes, is_active) from medications table
    // We still need this because inventory_full doesn't have all medication metadata
    // Match by medication_display_id (which is name + strength combination)
    const medicationDetailsQuery = `
      SELECT 
        id,
        name,
        strength,
        fefo,
        min_level_boxes,
        is_active
      FROM medications
      WHERE is_active = true
    `;
    const medicationDetailsResult = await db.query(medicationDetailsQuery);
    
    // Create a map by display_id (name + strength combination)
    const medicationDetailsByDisplayId = {};
    const medicationDetailsById = {};
    medicationDetailsResult.rows.forEach(med => {
      const displayId = med.strength && med.strength !== 'N/A'
        ? `${med.name} ${med.strength}`
        : med.name;
      const minLevelBoxes = Number.isFinite(Number(med.min_level_boxes)) ? Number(med.min_level_boxes) : 0;
      const details = {
        internalId: med.id,
        fefo: med.fefo,
        minLevelBoxes
      };
      medicationDetailsByDisplayId[displayId] = details;
      medicationDetailsById[med.id] = { ...details, displayId };
    });

    // Shape into front-end-friendly structure
    // Key = medicationDisplayId + locationId to create separate entries per location
    const medsByKey = {};
    for (const row of medsResult.rows) {
      const displayId = row.medication_display_id;
      const locationId = row.location_id;
      const key = `${displayId}|${locationId}`;
      
      // Get medication details from the map
      const medDetailsById = row.medication_id ? medicationDetailsById[row.medication_id] : undefined;
      const medDetails = medDetailsById || medicationDetailsByDisplayId[displayId] || {};

      // Use per-location minimum level from the joined table
      const rawRowMinLevelBoxes = row.location_min_level_boxes;
      const resolvedMinLevelBoxes = Number.isFinite(Number(rawRowMinLevelBoxes))
        ? Number(rawRowMinLevelBoxes)
        : 0;
      
      // Build display name: Medication Name + " " + Strength Raw (e.g., "Paracetamol 500mg")
      const displayName = row.strength_raw && row.strength_raw !== 'N/A'
        ? `${row.medication_name} ${row.strength_raw}`
        : row.medication_name;
      
      if (!medsByKey[key]) {
        medsByKey[key] = {
          id: displayId, // Use display_id as the identifier (no internal id exposed)
          internalId: row.medication_id || (medDetailsById && medDetailsById.internalId) || medDetails.internalId || null,
          name: displayName, // Display name: "Medication Name + Strength Raw"
          // Extended fields from inventory_full view for sorting/filtering
          medicationName: row.medication_name, // Base medication name (without strength)
          strength: row.strength_clean || '', // Clean strength from view
          strengthRaw: row.strength_raw || '', // Raw strength (e.g., "500mg" or "4mg/mL")
          medicationDisplayId: displayId, // Explicit display ID field
          minLevelBoxes: resolvedMinLevelBoxes,
          unit: row.type || 'units', // type field from view (form)
          type: row.type || 'stock', // type field from view (form)
          location: row.location_name,
          locationId: locationId,
          locationGroup: row.location_group || null, // Location group from inventory_full
          barcode: row.barcode || '', // Barcode from inventory_full
          standardItemsPerBox: null, // Not in view, would need separate query if needed
          fefo: medDetails.fefo || false,
          batches: []
        };
      }

      // Add batch with all fields from inventory_full view (only if on_hand > 0)
      if (row.batch_id && row.on_hand > 0) {
        medsByKey[key].batches.push({
          id: row.batch_id,
          quantity: row.on_hand, // on_hand from inventory_full
          expiryDate: row.expiry_date
            ? new Date(row.expiry_date).toISOString().slice(0,7)
            : null, // YYYY-MM format for display
          expiryDateFull: row.expiry_date ? new Date(row.expiry_date).toISOString() : null, // Full ISO date for sorting
          itemsPerBox: row.items_per_box || null, // items_per_box from inventory_full
          brand: row.brand || '', // brand from inventory_full
          batchNumber: row.batch_code || '', // batch_code from inventory_full
          numberOfBoxes: row.number_of_boxes || null // Calculated by view: on_hand / items_per_box
        });
      }
      // Note: If on_hand = 0, we still created the medication entry above,
      // but we don't add any batches. This allows medications with pending
      // orders to remain visible even when stock reaches zero.
    }

    // Calculate total number_of_boxes for each medication and add to response
    Object.values(medsByKey).forEach(med => {
      // Sum up number_of_boxes from all batches
      med.numberOfBoxes = med.batches.reduce((sum, batch) => {
        return sum + (batch.numberOfBoxes || 0);
      }, 0);
    });

    // Query pending orders BEFORE filtering medications
    // We need this to keep medications with pending orders even if they have no stock
    const ordersQuery = `
      SELECT
        o.id,
        o.medication_id,
        CASE
          WHEN m.strength IS NULL OR m.strength = 'N/A' THEN m.name
          ELSE m.name || ' ' || m.strength
        END AS med_name,
        o.quantity,
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
    `;
    const ordersResult = await db.query(ordersQuery);

    const orders = ordersResult.rows.map(row => ({
      id: row.id,
      medId: row.medication_id,
      medName: row.med_name || '',
      quantity: row.quantity,
      urgency: row.urgency,
      notes: row.notes || '',
      pharmacistEmail: row.pharmacist_email,
      status: row.status,
      orderedAt: row.ordered_at ? row.ordered_at.toISOString() : new Date().toISOString(),
      fulfilledAt: row.fulfilled_at ? row.fulfilled_at.toISOString() : null,
      user: row.user_name || 'System'
    }));

    // Create set of medication IDs with pending orders
    const medicationIdsWithOrders = new Set(orders.map(o => o.medId));

    // Filter medications: keep if they have batches OR have pending orders
    const medications = Object.values(medsByKey).filter(med =>
      med.batches.length > 0 || medicationIdsWithOrders.has(med.internalId)
    );

    // Query recent transactions for Activity tab
    // Join with batches to get medication_id, then join with medications for display info
    const txQuery = `
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
        u.username AS user_name
      FROM transactions t
      LEFT JOIN batches b ON b.id = t.batch_id
      LEFT JOIN medications m ON m.id = t.medication_id
      LEFT JOIN locations l ON l.id = t.location_id
      LEFT JOIN users u ON u.id = t.user_id
      ORDER BY t.occurred_at DESC
      LIMIT 200;
    `;
    const txResult = await db.query(txQuery);

    const transactions = txResult.rows.map(row => {
      // Use the type from database, or determine from delta if type is just 'in'/'out'
      let txType = row.type || 'system';

      // If type is generic 'in' or 'out', check reason to determine specific type
      if (txType === 'in' && row.reason && row.reason.startsWith('Order fulfilled')) {
        txType = 'order_fulfilled';
      } else if (txType === 'out' && row.reason && row.reason.startsWith('Batch removed')) {
        // Batch removal handled by location check in categorizeTransaction
        txType = 'out';
      }
      // Keep transfer transactions as 'in' or 'out' so frontend can pair them
      // The frontend pairing logic will combine them into a single 'transfer' entry

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
        note: row.reason || ''
      };
    });

    // Query all locations for UI dropdowns
    const locationsQuery = `
      SELECT id, display_name, group_name
      FROM locations
      ORDER BY
        CASE WHEN group_name IS NOT NULL THEN 0 ELSE 1 END,
        group_name,
        display_name;
    `;
    const locationsResult = await db.query(locationsQuery);

    const locations = locationsResult.rows.map(row => ({
      id: row.id,
      displayName: row.display_name,
      groupName: row.group_name
    }));

    // Orders already queried above (before filtering medications)
    // to allow medications with pending orders to remain visible even with zero stock

    return {
      statusCode: 200,
      body: JSON.stringify({
        medications,
        transactions,
        locations,
        orders
      })
    };
  } catch (e) {
    // Enhanced error logging for debugging
    console.error('=== meds-get error ===');
    console.error('Error name:', e.name);
    console.error('Error message:', e.message);
    console.error('Error stack:', e.stack);

    // Log specific error details for common database issues
    if (e.code) {
      console.error('Error code:', e.code);
    }
    if (e.detail) {
      console.error('Error detail:', e.detail);
    }
    if (e.hint) {
      console.error('Error hint:', e.hint);
    }

    // Return more informative error message in development
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const errorMessage = isDevelopment
      ? `Server error: ${e.message}`
      : 'Server error. Please try again or contact support.';

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        message: errorMessage,
        // Include error code if available for debugging
        ...(isDevelopment && e.code ? { errorCode: e.code } : {})
      })
    };
  }
};
