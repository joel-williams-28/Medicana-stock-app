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

    console.log('[TRANSFER] Received transfer request:', {
      userId,
      batchId,
      sourceLocationId,
      targetLocationId,
      quantity,
      reason
    });

    // Validate required fields (medicationId is no longer required from client)
    if (!userId || !batchId || !sourceLocationId || !targetLocationId || !quantity) {
      console.log('[TRANSFER] Validation failed - missing fields');
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
      console.log('[TRANSFER] Invalid quantity:', { quantity, type: typeof quantity });
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
    console.log('[TRANSFER] Beginning database transaction');
    await db.query('BEGIN');

    try {
      // Security: Derive medication_id from batch_id (do not trust client-provided medicationId)
      console.log('[TRANSFER] Looking up medication_id for batchId:', batchId);
      const batchQuery = await db.query(
        'SELECT medication_id FROM batches WHERE id = $1',
        [batchId]
      );

      if (batchQuery.rows.length === 0) {
        console.log('[TRANSFER] Batch not found in database');
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
      console.log('[TRANSFER] Found medicationId:', medicationId);

      // Step 1: Check source has enough stock
      console.log('[TRANSFER] Checking source inventory:', { sourceLocationId, batchId });
      const checkSource = await db.query(
        'SELECT on_hand FROM inventory WHERE location_id = $1 AND batch_id = $2',
        [sourceLocationId, batchId]
      );

      console.log('[TRANSFER] Source query result:', checkSource.rows);

      if (checkSource.rows.length === 0) {
        console.log('[TRANSFER] Source location does not have this batch');
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
      console.log('[TRANSFER] Source stock:', sourceStock, 'Requested:', quantity);

      if (sourceStock < quantity) {
        console.log('[TRANSFER] Not enough stock at source');
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
      console.log('[TRANSFER] Decreasing stock at source');
      await db.query(
        'UPDATE inventory SET on_hand = on_hand - $1 WHERE location_id = $2 AND batch_id = $3',
        [quantity, sourceLocationId, batchId]
      );
      console.log('[TRANSFER] Source stock decreased successfully');

      // Step 3: Insert transaction for source (outgoing transfer)
      console.log('[TRANSFER] Creating outgoing transaction record');
      await db.query(
        `INSERT INTO transactions
         (batch_id, location_id, medication_id, user_id, delta, type, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [batchId, sourceLocationId, medicationId, userId, -quantity, 'out', reason || `Transfer to ${targetLocationId}`]
      );
      console.log('[TRANSFER] Outgoing transaction created');

      // Step 4: Ensure target inventory row exists, then increase stock
      console.log('[TRANSFER] Ensuring target inventory row exists');
      await db.query(
        `INSERT INTO inventory (location_id, batch_id, on_hand)
         VALUES ($1, $2, 0)
         ON CONFLICT (location_id, batch_id) DO NOTHING`,
        [targetLocationId, batchId]
      );
      console.log('[TRANSFER] Target inventory row ensured');

      console.log('[TRANSFER] Increasing stock at target');
      await db.query(
        'UPDATE inventory SET on_hand = on_hand + $1 WHERE location_id = $2 AND batch_id = $3',
        [quantity, targetLocationId, batchId]
      );
      console.log('[TRANSFER] Target stock increased successfully');

      // Step 5: Insert transaction for target (incoming transfer)
      console.log('[TRANSFER] Creating incoming transaction record');
      await db.query(
        `INSERT INTO transactions
         (batch_id, location_id, medication_id, user_id, delta, type, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [batchId, targetLocationId, medicationId, userId, quantity, 'in', reason || `Transfer from ${sourceLocationId}`]
      );
      console.log('[TRANSFER] Incoming transaction created');

      // Commit transaction
      console.log('[TRANSFER] Committing transaction');
      await db.query('COMMIT');
      console.log('[TRANSFER] Transaction committed successfully');

      return {
        statusCode: 200,
        body: JSON.stringify({ success: true })
      };
    } catch (err) {
      console.error('[TRANSFER] Error in transaction, rolling back:', err);
      await db.query('ROLLBACK');
      throw err;
    }
  } catch (e) {
    console.error('[TRANSFER] Fatal error:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        message: 'Server error: ' + e.message,
        error: e.toString()
      })
    };
  }
};
