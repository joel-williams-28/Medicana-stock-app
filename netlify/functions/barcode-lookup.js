// netlify/functions/barcode-lookup.js
// Looks up medication by barcode and returns medication details + existing batches
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      body: JSON.stringify({ success: false, message: 'Method not allowed' }) 
    };
  }

  try {
    const { barcode } = JSON.parse(event.body || '{}');

    if (!barcode || !barcode.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Barcode is required' 
        })
      };
    }

    // Find medication by barcode
    const medResult = await db.query(
      `SELECT id, name, strength, form, standard_items_per_box, barcode
       FROM medications
       WHERE barcode = $1`,
      [barcode.trim()]
    );

    if (medResult.rows.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          found: false
        })
      };
    }

    const medication = medResult.rows[0];
    
    // Get strength_raw (e.g., "500mg" or "4mg/mL")
    // The strength field contains the raw strength value
    const strengthRaw = medication.strength && medication.strength !== 'N/A' 
      ? medication.strength 
      : null;

    // Get existing batches for this medication
    const batchesResult = await db.query(
      `SELECT id, batch_code, expiry_date, brand, items_per_box
       FROM batches
       WHERE medication_id = $1
       ORDER BY expiry_date DESC, batch_code`,
      [medication.id]
    );

    const existingBatches = batchesResult.rows.map(batch => ({
      id: batch.id,
      batchCode: batch.batch_code || '',
      expiryDate: batch.expiry_date 
        ? new Date(batch.expiry_date).toISOString().slice(0, 10) // YYYY-MM-DD format
        : null,
      itemsPerBox: batch.items_per_box || null,
      brand: batch.brand || ''
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        found: true,
        medication: {
          id: medication.id,
          name: medication.name,
          strength_raw: strengthRaw,
          type: medication.form || 'Tablet',
          standard_items_per_box: medication.standard_items_per_box || null,
          barcode: medication.barcode
        },
        existingBatches
      })
    };
  } catch (e) {
    console.error('barcode-lookup error:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: 'Server error.' })
    };
  }
};

