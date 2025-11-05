// netlify/functions/meds-get.js
// Returns all medications (with batches/inventory), recent transactions, and locations list
const db = require('./_db');

exports.handler = async () => {
  try {
    // Query medication/stock snapshot from inventory_full view
    // Group by medication + location to match the UI's expectation of one medication per location
    const medsQuery = `
      SELECT
        location_id,
        batch_id,
        on_hand,
        location_name,
        location_group,
        medication_id,
        medication_name,
        barcode,
        batch_code,
        expiry_date,
        brand,
        items_per_box,
        number_of_boxes
      FROM inventory_full
      WHERE on_hand > 0
      ORDER BY medication_name, location_name, expiry_date;
    `;
    const medsResult = await db.query(medsQuery);

    // Get medication details (strength, form, fefo, min_level, standard_items_per_box) from medications table
    // We need this because inventory_full only has medication_name, not the full medication details
    const medicationDetailsQuery = `
      SELECT 
        id,
        name,
        strength,
        form,
        fefo,
        min_level,
        standard_items_per_box
      FROM medications
    `;
    const medicationDetailsResult = await db.query(medicationDetailsQuery);
    const medicationDetailsMap = {};
    medicationDetailsResult.rows.forEach(med => {
      medicationDetailsMap[med.id] = {
        strength: med.strength,
        form: med.form,
        fefo: med.fefo,
        minLevel: med.min_level,
        standardItemsPerBox: med.standard_items_per_box
      };
    });

    // Shape into front-end-friendly structure
    // Key = medicationId + locationId to create separate entries per location
    const medsByKey = {};
    for (const row of medsResult.rows) {
      const medId = row.medication_id;
      const locationId = row.location_id;
      const key = `${medId}|${locationId}`;
      
      // Get medication details from the map
      const medDetails = medicationDetailsMap[medId] || {};
      const strength = medDetails.strength;
      
      if (!medsByKey[key]) {
        medsByKey[key] = {
          id: medId,
          name: (strength && strength !== 'N/A')
            ? `${row.medication_name} ${strength}`
            : row.medication_name,
          // Extended fields from inventory_full view for sorting/filtering
          medicationName: row.medication_name, // Base medication name (without strength)
          strength: strength || '',
          minLevel: medDetails.minLevel || 0,
          unit: medDetails.form || 'units',
          type: medDetails.form || 'stock',
          location: row.location_name,
          locationId: locationId,
          locationGroup: row.location_group || null, // Location group from inventory_full
          barcode: row.barcode || '', // Barcode from inventory_full
          standardItemsPerBox: medDetails.standardItemsPerBox || null,
          fefo: medDetails.fefo || false,
          batches: []
        };
      }

      // Add batch with all fields from inventory_full view
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
    }

    // Remove entries with no batches (no actual stock)
    const medications = Object.values(medsByKey).filter(med => med.batches.length > 0);

    // Query recent transactions for Activity tab
    const txQuery = `
      SELECT
        t.id,
        t.medication_id,
        CASE 
          WHEN m.strength IS NULL OR m.strength = 'N/A' THEN m.name
          ELSE m.name || ' ' || m.strength
        END AS med_name,
        t.delta,
        t.reason,
        t.location_id,
        l.display_name AS location_name,
        l.group_name AS location_group,
        t.occurred_at,
        u.username AS user_name
      FROM transactions t
      LEFT JOIN medications m ON m.id = t.medication_id
      LEFT JOIN locations l ON l.id = t.location_id
      LEFT JOIN users u ON u.id = t.user_id
      ORDER BY t.occurred_at DESC
      LIMIT 200;
    `;
    const txResult = await db.query(txQuery);

    const transactions = txResult.rows.map(row => {
      let txType = 'system';
      if (row.delta > 0) txType = 'in';
      if (row.delta < 0) txType = 'out';

      return {
        id: row.id,
        medId: row.medication_id,
        medName: row.med_name || '',
        type: txType,
        amount: Math.abs(row.delta),
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

    return {
      statusCode: 200,
      body: JSON.stringify({
        medications,
        transactions,
        locations
      })
    };
  } catch (e) {
    console.error('meds-get error:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: 'Server error.' })
    };
  }
};

