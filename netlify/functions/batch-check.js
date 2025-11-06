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
    // Also get medication display ID for frontend matching
    const result = await db.query(
      `SELECT 
         b.id, 
         b.medication_id, 
         b.expiry_date, 
         b.brand, 
         b.items_per_box, 
         b.batch_code,
         CASE 
           WHEN m.strength IS NULL OR m.strength = 'N/A' THEN m.name
           ELSE m.name || ' ' || m.strength
         END AS medication_display_id
       FROM batches b
       LEFT JOIN medications m ON m.id = b.medication_id
       WHERE b.batch_code = $1`,
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
            medicationId: batch.medication_id, // Internal ID (for reference)
            medicationDisplayId: batch.medication_display_id || null, // Display ID for frontend matching
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


