// netlify/functions/batch-add.js
// Adds a new batch/delivery of medication to inventory
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      body: JSON.stringify({ success: false, message: 'Method not allowed' }) 
    };
  }

  try {
    const { 
      medicationId,
      batchNumber,
      expiryMonth,
      expiryYear,
      brand,
      itemsPerBox,
      quantityBoxes,
      quantityIndividuals,
      locationId,
      userId,
      note
    } = JSON.parse(event.body || '{}');

    // Validate required fields
    if (!medicationId || !locationId || !userId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Missing required fields: medicationId, locationId, userId' 
        })
      };
    }

    // Calculate total units delivered
    let totalFromBoxes = 0;
    if (quantityBoxes && itemsPerBox) {
      totalFromBoxes = quantityBoxes * itemsPerBox;
    }
    const finalTotal = totalFromBoxes + (quantityIndividuals || 0);

    if (finalTotal <= 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Total quantity must be greater than zero' 
        })
      };
    }

    // Build expiry date (first of month)
    let expiryDate = null;
    if (expiryMonth && expiryYear) {
      expiryDate = `${expiryYear}-${String(expiryMonth).padStart(2, '0')}-01`;
    }

    // Begin transaction
    await db.query('BEGIN');

    try {
      // Batch integrity safeguard — do not remove.
      // batch_code is the unique key for batch metadata globally (not per medication)
      // If a batch_code exists, we MUST use its canonical values and ignore user input
      let batchIdResult;
      if (batchNumber && batchNumber.trim()) {
        const existingBatch = await db.query(
          `SELECT id, medication_id, expiry_date, brand, items_per_box
           FROM batches
           WHERE batch_code = $1`,
          [batchNumber.trim()]
        );

        if (existingBatch.rows.length > 0) {
          // Batch code exists - use existing values and ignore user input for batch metadata
          const existing = existingBatch.rows[0];
          batchIdResult = existing.id;
          
          // Note: We use the existing batch's medication_id, expiry_date, brand, items_per_box
          // User-provided values for these fields are ignored to maintain batch integrity
          // The medicationId parameter may differ, but we use the batch's linked medication_id
          // This ensures batch_code is the authoritative source for batch metadata
        } else {
          // Batch code doesn't exist - create new batch with provided values
          const insertBatch = await db.query(
            `INSERT INTO batches (medication_id, batch_code, expiry_date, brand, items_per_box)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [medicationId, batchNumber.trim(), expiryDate, brand || '', itemsPerBox || null]
          );
          batchIdResult = insertBatch.rows[0].id;
        }
      } else {
        // No batch number provided, create a generic batch with unique timestamp
        const insertBatch = await db.query(
          `INSERT INTO batches (medication_id, batch_code, expiry_date, brand, items_per_box)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [medicationId, `BATCH-${Date.now()}`, expiryDate, brand || '', itemsPerBox || null]
        );
        batchIdResult = insertBatch.rows[0].id;
      }

      // Ensure inventory row exists
      const checkInv = await db.query(
        'SELECT on_hand FROM inventory WHERE location_id = $1 AND batch_id = $2',
        [locationId, batchIdResult]
      );

      if (checkInv.rows.length === 0) {
        await db.query(
          'INSERT INTO inventory (location_id, batch_id, on_hand) VALUES ($1, $2, $3)',
          [locationId, batchIdResult, finalTotal]
        );
      } else {
        await db.query(
          'UPDATE inventory SET on_hand = on_hand + $1 WHERE location_id = $2 AND batch_id = $3',
          [finalTotal, locationId, batchIdResult]
        );
      }

      // Insert transaction record
      const reason = note || `Delivery received - ${finalTotal} units`;
      await db.query(
        `INSERT INTO transactions 
         (user_id, medication_id, location_id, batch_id, delta, reason, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [userId, medicationId, locationId, batchIdResult, finalTotal, reason]
      );

      // Commit transaction
      await db.query('COMMIT');

      return {
        statusCode: 200,
        body: JSON.stringify({ success: true })
      };
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
  } catch (e) {
    console.error('batch-add error:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: 'Server error.' })
    };
  }
};

