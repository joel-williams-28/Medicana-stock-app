// netlify/functions/batch-add.js
// Adds a new batch/delivery of medication to inventory
// Supports both existing batch selection and new batch creation with integrity enforcement
const db = require('./_db');
const { logActivity } = require('./_activity-log');

// Build expiry date string (last day of month) from month/year
function buildExpiryDate(expiryMonth, expiryYear) {
  if (!expiryMonth || !expiryYear) return null;
  const month = parseInt(expiryMonth);
  const year = parseInt(expiryYear);
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const {
      medicationId,
      existingBatchId,
      batchNumber,
      batchCode,
      expiryMonth,
      expiryYear,
      brand,
      itemsPerBox,
      quantityBoxes,
      quantityIndividuals,
      locationId,
      userId,
      note,
      reason,
      serial,
      medicationName
    } = JSON.parse(event.body || '{}');

    const transactionNote = reason || note;

    if (!locationId || !userId) {
      return db.fail(400, 'Missing required fields: locationId, userId');
    }

    // Calculate total units delivered
    const totalFromBoxes = (quantityBoxes && itemsPerBox) ? quantityBoxes * itemsPerBox : 0;
    const finalTotal = totalFromBoxes + (quantityIndividuals || 0);

    if (finalTotal <= 0) {
      return db.fail(400, 'Total quantity must be greater than zero');
    }

    await db.query('BEGIN');

    try {
      let batchIdResult;
      let canonicalMedicationId;

      // Batch integrity safeguard -- do not remove.
      if (existingBatchId) {
        // Use existing batch - fetch its canonical metadata
        const existingBatch = await db.query(
          `SELECT id, medication_id FROM batches WHERE id = $1`,
          [existingBatchId]
        );

        if (existingBatch.rows.length === 0) {
          await db.query('ROLLBACK');
          return db.fail(400, 'Existing batch not found');
        }

        batchIdResult = existingBatch.rows[0].id;
        canonicalMedicationId = existingBatch.rows[0].medication_id;
      } else {
        const batchCodeToUse = batchNumber || batchCode;
        const expiryDate = buildExpiryDate(expiryMonth, expiryYear);

        if (batchCodeToUse && batchCodeToUse.trim()) {
          // Check if batch_code already exists
          const existingBatch = await db.query(
            `SELECT id, medication_id FROM batches WHERE batch_code = $1`,
            [batchCodeToUse.trim()]
          );

          if (existingBatch.rows.length > 0) {
            // Batch code exists - use existing values to maintain batch integrity
            // Safety: if the caller specified a different medication, warn but still use canonical batch
            if (medicationId && existingBatch.rows[0].medication_id !== medicationId) {
              console.warn(`batch-add: batch_code "${batchCodeToUse}" belongs to medication ${existingBatch.rows[0].medication_id}, but caller sent medicationId ${medicationId}. Using canonical medication.`);
            }
            batchIdResult = existingBatch.rows[0].id;
            canonicalMedicationId = existingBatch.rows[0].medication_id;
          } else {
            // Create new batch
            if (!medicationId) {
              await db.query('ROLLBACK');
              return db.fail(400, 'medicationId is required when creating a new batch');
            }

            const insertBatch = await db.query(
              `INSERT INTO batches (medication_id, batch_code, expiry_date, brand, items_per_box, serial)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING id, medication_id`,
              [medicationId, batchCodeToUse.trim(), expiryDate, brand || '', itemsPerBox || null, serial || null]
            );
            batchIdResult = insertBatch.rows[0].id;
            canonicalMedicationId = insertBatch.rows[0].medication_id;
          }
        } else {
          // No batch number provided - create a generic batch with unique timestamp
          if (!medicationId) {
            await db.query('ROLLBACK');
            return db.fail(400, 'medicationId is required when creating a new batch');
          }

          const insertBatch = await db.query(
            `INSERT INTO batches (medication_id, batch_code, expiry_date, brand, items_per_box, serial)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, medication_id`,
            [medicationId, `BATCH-${Date.now()}`, expiryDate, brand || '', itemsPerBox || null, serial || null]
          );
          batchIdResult = insertBatch.rows[0].id;
          canonicalMedicationId = insertBatch.rows[0].medication_id;
        }
      }

      // Upsert inventory row (atomic — avoids race condition)
      await db.query(
        `INSERT INTO inventory (location_id, batch_id, on_hand) VALUES ($1, $2, $3)
         ON CONFLICT (location_id, batch_id) DO UPDATE SET on_hand = inventory.on_hand + $3`,
        [locationId, batchIdResult, finalTotal]
      );

      // Insert transaction record for delivery
      await db.query(
        `INSERT INTO transactions
         (batch_id, location_id, medication_id, user_id, delta, type, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [batchIdResult, locationId, canonicalMedicationId, userId, finalTotal, 'in',
         transactionNote || `Delivery received - ${finalTotal} units`]
      );

      await db.query('COMMIT');

      const batchCodeUsed = batchNumber || batchCode || null;
      const expiryDate = buildExpiryDate(expiryMonth, expiryYear);
      await logActivity({
        userId,
        actionType: 'stock_in',
        entityType: 'medication',
        entityId: canonicalMedicationId,
        locationId,
        details: {
          medicationName: medicationName || null,
          batchId: batchIdResult,
          batchCode: batchCodeUsed,
          expiryDate: expiryDate || null,
          brand: brand || null,
          delta: finalTotal,
          quantityBoxes: quantityBoxes || null,
          itemsPerBox: itemsPerBox || null,
          reason: transactionNote || `Delivery received - ${finalTotal} units`,
          isNewBatch: !existingBatchId
        }
      });

      return db.ok();
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
  } catch (e) {
    return db.serverError('batch-add', e);
  }
};
