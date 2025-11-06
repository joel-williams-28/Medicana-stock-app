// netlify/functions/stock-transfer.js
// Handles transfers of stock between two locations
// Security: medication_id is derived from batch_id on the server, not trusted from client
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
      userId, 
      batchId, 
      sourceLocationId, 
      targetLocationId, 
      quantity, 
      reason 
    } = JSON.parse(event.body || '{}');

    // Validate required fields (medicationId is no longer required from client)
    if (!userId || !batchId || !sourceLocationId || !targetLocationId || !quantity) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Missing or invalid fields',
          debug: { userId, batchId, sourceLocationId, targetLocationId, quantity }
        })
      };
    }

    if (typeof quantity !== 'number' || quantity <= 0 || !Number.isInteger(quantity)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Quantity must be a positive integer',
          debug: { quantity, type: typeof quantity }
        })
      };
    }

    // Begin transaction
    await db.query('BEGIN');

    try {
      // Security: Derive medication_id from batch_id (do not trust client-provided medicationId)
      const batchQuery = await db.query(
        'SELECT medication_id FROM batches WHERE id = $1',
        [batchId]
      );

      if (batchQuery.rows.length === 0) {
        await db.query('ROLLBACK');
        return {
          statusCode: 400,
          body: JSON.stringify({ 
            success: false, 
            message: 'Batch not found',
            debug: { batchId }
          })
        };
      }

      const medicationId = batchQuery.rows[0].medication_id;

      // Step 1: Check source has enough stock
      const checkSource = await db.query(
        'SELECT on_hand FROM inventory WHERE location_id = $1 AND batch_id = $2',
        [sourceLocationId, batchId]
      );

      if (checkSource.rows.length === 0) {
        await db.query('ROLLBACK');
        return {
          statusCode: 400,
          body: JSON.stringify({ 
            success: false, 
            message: 'Source location does not have this batch in inventory',
            debug: { sourceLocationId, batchId }
          })
        };
      }

      const sourceStock = checkSource.rows[0].on_hand;
      if (sourceStock < quantity) {
        await db.query('ROLLBACK');
        return {
          statusCode: 400,
          body: JSON.stringify({ 
            success: false, 
            message: 'Not enough stock at source',
            debug: { available: sourceStock, requested: quantity }
          })
        };
      }

      // Step 2: Decrease stock at source
      await db.query(
        'UPDATE inventory SET on_hand = on_hand - $1 WHERE location_id = $2 AND batch_id = $3',
        [quantity, sourceLocationId, batchId]
      );

      // Step 3: Insert transaction for source (negative delta, using server-derived medication_id)
      await db.query(
        `INSERT INTO transactions 
         (user_id, medication_id, location_id, batch_id, delta, reason, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [userId, medicationId, sourceLocationId, batchId, -quantity, reason || `Transfer to ${targetLocationId}`]
      );

      // Step 4: Ensure target inventory row exists, then increase stock
      await db.query(
        `INSERT INTO inventory (location_id, batch_id, on_hand)
         VALUES ($1, $2, 0)
         ON CONFLICT (location_id, batch_id) DO NOTHING`,
        [targetLocationId, batchId]
      );

      await db.query(
        'UPDATE inventory SET on_hand = on_hand + $1 WHERE location_id = $2 AND batch_id = $3',
        [quantity, targetLocationId, batchId]
      );

      // Step 5: Insert transaction for target (positive delta, using server-derived medication_id)
      await db.query(
        `INSERT INTO transactions 
         (user_id, medication_id, location_id, batch_id, delta, reason, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [userId, medicationId, targetLocationId, batchId, quantity, reason || `Transfer from ${sourceLocationId}`]
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
    console.error('stock-transfer error:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: 'Server error.' })
    };
  }
};
