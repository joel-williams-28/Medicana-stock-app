// netlify/functions/batch-add.js
// Adds a new batch/delivery of medication to inventory
// Supports both existing batch selection and new batch creation with integrity enforcement
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
      existingBatchId, // If provided, use this batch's metadata
      batchNumber, // For new batch creation
      batchCode, // Alternative name for batchNumber
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
    if (!locationId || !userId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Missing required fields: locationId, userId' 
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

    // Begin transaction
    await db.query('BEGIN');

    try {
      let batchIdResult;
      let canonicalMedicationId; // Will be derived from batch

      // Batch integrity safeguard — do not remove.
      if (existingBatchId) {
        // Use existing batch - fetch its canonical metadata
        const existingBatch = await db.query(
          `SELECT id, medication_id, expiry_date, brand, items_per_box, batch_code
           FROM batches
           WHERE id = $1`,
          [existingBatchId]
        );

        if (existingBatch.rows.length === 0) {
          await db.query('ROLLBACK');
          return {
            statusCode: 400,
            body: JSON.stringify({ 
              success: false, 
              message: 'Existing batch not found' 
            })
          };
        }

        const existing = existingBatch.rows[0];
        batchIdResult = existing.id;
        canonicalMedicationId = existing.medication_id;
        
        // Use existing batch's metadata - ignore any client-provided overrides
        // This ensures batch_code is the authoritative source for batch metadata
      } else {
        // Create new batch or use existing batch_code
        const batchCodeToUse = batchNumber || batchCode;
        
        if (batchCodeToUse && batchCodeToUse.trim()) {
          // Check if batch_code already exists
          const existingBatch = await db.query(
            `SELECT id, medication_id, expiry_date, brand, items_per_box
             FROM batches
             WHERE batch_code = $1`,
            [batchCodeToUse.trim()]
          );

          if (existingBatch.rows.length > 0) {
            // Batch code exists - use existing values and ignore user input for batch metadata
            const existing = existingBatch.rows[0];
            batchIdResult = existing.id;
            canonicalMedicationId = existing.medication_id;
            
            // Note: We use the existing batch's medication_id, expiry_date, brand, items_per_box
            // User-provided values for these fields are ignored to maintain batch integrity
          } else {
            // Batch code doesn't exist - create new batch with provided values
            if (!medicationId) {
              await db.query('ROLLBACK');
              return {
                statusCode: 400,
                body: JSON.stringify({ 
                  success: false, 
                  message: 'medicationId is required when creating a new batch' 
                })
              };
            }

            // Build expiry date (last day of month)
            let expiryDate = null;
            if (expiryMonth && expiryYear) {
              const month = parseInt(expiryMonth);
              const year = parseInt(expiryYear);
              // Get the last day of the month
              const lastDay = new Date(year, month, 0).getDate();
              expiryDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
            }

            const insertBatch = await db.query(
              `INSERT INTO batches (medication_id, batch_code, expiry_date, brand, items_per_box)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id, medication_id`,
              [medicationId, batchCodeToUse.trim(), expiryDate, brand || '', itemsPerBox || null]
            );
            batchIdResult = insertBatch.rows[0].id;
            canonicalMedicationId = insertBatch.rows[0].medication_id;
          }
        } else {
          // No batch number provided, create a generic batch with unique timestamp
          if (!medicationId) {
            await db.query('ROLLBACK');
            return {
              statusCode: 400,
              body: JSON.stringify({ 
                success: false, 
                message: 'medicationId is required when creating a new batch' 
              })
            };
          }

          // Build expiry date (last day of month)
          let expiryDate = null;
          if (expiryMonth && expiryYear) {
            const month = parseInt(expiryMonth);
            const year = parseInt(expiryYear);
            // Get the last day of the month
            const lastDay = new Date(year, month, 0).getDate();
            expiryDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
          }

          const insertBatch = await db.query(
            `INSERT INTO batches (medication_id, batch_code, expiry_date, brand, items_per_box)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, medication_id`,
            [medicationId, `BATCH-${Date.now()}`, expiryDate, brand || '', itemsPerBox || null]
          );
          batchIdResult = insertBatch.rows[0].id;
          canonicalMedicationId = insertBatch.rows[0].medication_id;
        }
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

      // Insert transaction record using canonical medication_id derived from batch
      const reason = note || `Delivery received - ${finalTotal} units`;
      await db.query(
        `INSERT INTO transactions 
         (user_id, medication_id, location_id, batch_id, delta, reason, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [userId, canonicalMedicationId, locationId, batchIdResult, finalTotal, reason]
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
