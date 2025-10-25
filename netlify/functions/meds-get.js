// netlify/functions/meds-get.js
// Returns all medications (with batches/inventory), recent transactions, and locations list
const db = require('./_db');

exports.handler = async () => {
  try {
    // Query medication/stock snapshot
    // Group by medication + location to match the UI's expectation of one medication per location
    const medsQuery = `
      SELECT
        m.id AS medication_id,
        m.name,
        m.strength,
        m.form,
        m.fefo,
        m.min_level,
        m.standard_items_per_box,
        m.barcode,
        l.id AS location_id,
        l.display_name AS location_name,
        b.id AS batch_id,
        b.batch_code,
        b.expiry_date,
        b.brand,
        b.items_per_box,
        inv.on_hand
      FROM medications m
      CROSS JOIN locations l
      LEFT JOIN batches b ON b.medication_id = m.id
      LEFT JOIN inventory inv ON inv.batch_id = b.id AND inv.location_id = l.id
      WHERE inv.on_hand > 0 OR (b.id IS NULL)
      ORDER BY m.name, l.display_name, b.expiry_date;
    `;
    const medsResult = await db.query(medsQuery);

    // Shape into front-end-friendly structure
    // Key = medicationId + locationId to create separate entries per location
    const medsByKey = {};
    for (const row of medsResult.rows) {
      const medId = row.medication_id;
      const locationId = row.location_id;
      const key = `${medId}|${locationId}`;
      
      if (!medsByKey[key]) {
        medsByKey[key] = {
          id: medId,
          name: row.strength
            ? `${row.name} ${row.strength}`
            : row.name,
          minLevel: row.min_level || 0,
          unit: row.form || 'units',
          type: row.form || 'stock',
          location: row.location_name,
          locationId: locationId,  // Store internal ID but don't display it
          barcode: row.barcode || '',
          standardItemsPerBox: row.standard_items_per_box || null,
          fefo: row.fefo || false,
          batches: []
        };
      }

      // Only add batches that have stock at this location
      if (row.batch_id && row.on_hand > 0) {
        medsByKey[key].batches.push({
          id: row.batch_id,
          quantity: row.on_hand,
          expiryDate: row.expiry_date
            ? new Date(row.expiry_date).toISOString().slice(0,7)
            : null,
          itemsPerBox: row.items_per_box || null,
          brand: row.brand || '',
          batchNumber: row.batch_code || ''
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
        (m.name || ' ' || COALESCE(m.strength,'')) AS med_name,
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

