// netlify/functions/batch-check.js
// Checks if a batch_code exists and returns its canonical details
// Batch integrity safeguard — do not remove.

const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      body: JSON.stringify({ success: false, message: 'Method not allowed' }) 
    };
  }

  try {
    const { batchCode } = JSON.parse(event.body || '{}');

    if (!batchCode || !batchCode.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'batchCode is required' 
        })
      };
    }

    // Batch integrity safeguard — do not remove.
    // Check if batch_code exists globally (it's the unique key for batch metadata)
    const result = await db.query(
      `SELECT id, medication_id, expiry_date, brand, items_per_box, batch_code
       FROM batches
       WHERE batch_code = $1`,
      [batchCode.trim()]
    );

    if (result.rows.length > 0) {
      const batch = result.rows[0];
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          exists: true,
          batch: {
            id: batch.id,
            medicationId: batch.medication_id,
            batchCode: batch.batch_code,
            expiryDate: batch.expiry_date ? new Date(batch.expiry_date).toISOString().slice(0, 7) : null, // YYYY-MM format
            expiryDateFull: batch.expiry_date ? batch.expiry_date.toISOString() : null,
            brand: batch.brand || '',
            itemsPerBox: batch.items_per_box || null
          }
        })
      };
    } else {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          exists: false,
          batch: null
        })
      };
    }
  } catch (e) {
    console.error('batch-check error:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: 'Server error.' })
    };
  }
};

