// netlify/functions/stock-transfer.js
// Handles transfers of stock between two locations
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
      medicationId, 
      batchId, 
      sourceLocationId, 
      targetLocationId, 
      quantity, 
      reason 
    } = JSON.parse(event.body || '{}');

    // Validate required fields
    if (!userId || !medicationId || !batchId || !sourceLocationId || !targetLocationId || !quantity) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Missing required fields: userId, medicationId, batchId, sourceLocationId, targetLocationId, quantity' 
        })
      };
    }

    if (quantity <= 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Quantity must be greater than zero' 
        })
      };
    }

    // Begin transaction
    await db.query('BEGIN');

    try {
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
            message: 'Source location does not have this batch in inventory' 
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
            message: `Insufficient stock at source. Available: ${sourceStock}, requested: ${quantity}` 
          })
        };
      }

      // Step 2: Decrease stock at source
      const newSourceStock = sourceStock - quantity;
      if (newSourceStock > 0) {
        await db.query(
          'UPDATE inventory SET on_hand = $1 WHERE location_id = $2 AND batch_id = $3',
          [newSourceStock, sourceLocationId, batchId]
        );
      } else {
        // Remove row if stock reaches zero
        await db.query(
          'DELETE FROM inventory WHERE location_id = $1 AND batch_id = $2',
          [sourceLocationId, batchId]
        );
      }

      // Step 3: Insert transaction for source (negative delta)
      await db.query(
        `INSERT INTO transactions 
         (user_id, medication_id, location_id, batch_id, delta, reason, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [userId, medicationId, sourceLocationId, batchId, -quantity, reason || `Transfer to ${targetLocationId}`]
      );

      // Step 4: Ensure target inventory row exists, then increase stock
      const checkTarget = await db.query(
        'SELECT on_hand FROM inventory WHERE location_id = $1 AND batch_id = $2',
        [targetLocationId, batchId]
      );

      if (checkTarget.rows.length === 0) {
        // Insert new inventory row at target
        await db.query(
          'INSERT INTO inventory (location_id, batch_id, on_hand) VALUES ($1, $2, $3)',
          [targetLocationId, batchId, quantity]
        );
      } else {
        // Update existing inventory at target
        await db.query(
          'UPDATE inventory SET on_hand = on_hand + $1 WHERE location_id = $2 AND batch_id = $3',
          [quantity, targetLocationId, batchId]
        );
      }

      // Step 5: Insert transaction for target (positive delta)
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

