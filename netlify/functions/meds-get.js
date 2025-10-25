// netlify/functions/meds-get.js
// Returns all medications (with batches/inventory) and recent transactions
const db = require('./_db');

exports.handler = async () => {
  try {
    // Query medication/stock snapshot
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
        l.name AS location_name,
        b.id AS batch_id,
        b.batch_code,
        b.expiry_date,
        b.brand,
        b.items_per_box,
        inv.on_hand
      FROM medications m
      LEFT JOIN batches b ON b.medication_id = m.id
      LEFT JOIN inventory inv ON inv.batch_id = b.id
      LEFT JOIN locations l ON l.id = inv.location_id
      ORDER BY m.name, l.name, b.expiry_date;
    `;
    const medsResult = await db.query(medsQuery);

    // Shape into front-end-friendly structure
    const medsById = {};
    for (const row of medsResult.rows) {
      const medId = row.medication_id;
      if (!medsById[medId]) {
        medsById[medId] = {
          id: medId,
          name: row.strength
            ? `${row.name} ${row.strength}`
            : row.name,
          minLevel: row.min_level || 0,
          unit: row.form || 'units',            // fallback
          type: row.form || 'stock',            // UI uses "type"
          location: row.location_name || 'Unknown Location',
          barcode: row.barcode || '',
          standardItemsPerBox: row.standard_items_per_box || null,
          batches: []
        };
      }

      if (row.batch_id) {
        medsById[medId].batches.push({
          id: row.batch_id,
          quantity: row.on_hand || 0,
          expiryDate: row.expiry_date
            ? new Date(row.expiry_date).toISOString().slice(0,7) // "YYYY-MM"
            : null,
          itemsPerBox: row.items_per_box || null,
          brand: row.brand || '',
          batchNumber: row.batch_code || ''
        });
      }
    }

    const medications = Object.values(medsById);

    // Query recent transactions for Activity tab
    const txQuery = `
      SELECT
        t.id,
        t.medication_id,
        (m.name || ' ' || COALESCE(m.strength,'')) AS med_name,
        t.delta,
        t.reason,
        t.location_id,
        l.name AS location_name,
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
        timestamp: row.occurred_at
          ? row.occurred_at.toISOString()
          : new Date().toISOString(),
        note: row.reason || ''
      };
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        medications,
        transactions
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

